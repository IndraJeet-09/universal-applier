import type { SemanticField } from '@schemas/dom';
import type { CandidateProfile } from '@schemas/candidate';
import type { AutofillSettings, ReviewItem, FieldMapping } from '@schemas/application';
import { classifyField, type Classification } from './fieldClassifier';
import { isSensitiveKey, isLegalDeclaration } from './taxonomy';
import { resolveValue, matchOption, type ValueSource, type MatchResult } from './candidateMatcher';
import { decideFill, type FillDecision } from './confidence';

export type PlanValueSource = ValueSource | 'ai_generated';

export interface PlannedFill {
  fieldId: string;
  fingerprint: string;
  selector: string;
  kind: 'value' | 'file';
  semanticField: string;
  /** Human-readable field label shown in review UIs. */
  label: string;
  category: string;
  sensitive: boolean;
  classification: Classification;
  decision: FillDecision;
  value: string | null;
  valueSource: PlanValueSource | null;
  /** Profile path the value came from, e.g. `personal.email`. */
  candidatePath?: string;
  confidence: number;
  reason: string;
  review?: ReviewItem;
}

export interface FillPlanSummary {
  total: number;
  autoFill: number;
  fillHighlight: number;
  askUser: number;
  skip: number;
  sensitive: number;
  unknown: number;
  aiClassified: number;
}

export interface FillPlan {
  actions: PlannedFill[];
  /** Semantic field → candidate value mappings, ready for user inspection. */
  mappings: FieldMapping[];
  summary: FillPlanSummary;
}

export interface PlannerHooks {
  classifyWithAI?: (field: SemanticField) => Promise<Classification | null>;
  generateAnswer?: (input: {
    field: SemanticField;
    semanticField: string;
    category: string;
    question: string;
  }) => Promise<{ answer: string; confidence: number } | null>;
}

const CHOICE_TYPES = new Set(['select', 'radio', 'role-combobox']);

function primaryText(field: SemanticField): string {
  return [field.label, field.ariaLabel, field.placeholder].filter(Boolean).join(' ').trim();
}

async function classifyWithFallback(
  field: SemanticField,
  hooks: PlannerHooks
): Promise<Classification> {
  let classification = classifyField(field);
  if (classification.confidence >= 0.6 || !hooks.classifyWithAI) return classification;
  try {
    const ai = await hooks.classifyWithAI(field);
    if (ai && ai.confidence > classification.confidence) {
      classification = { ...ai, method: 'ai' };
    }
  } catch {
    /* deterministic result is a valid fallback */
  }
  return classification;
}

function resolveChoiceValue(field: SemanticField, match: MatchResult): MatchResult {
  if (!field.options || field.options.length === 0) return match;
  if (match.value === null) return match;
  const matched = matchOption(field.options, match.value);
  if (matched) return { ...match, value: matched };
  return {
    ...match,
    value: null,
    reason: `no option matches profile value "${match.value}"`,
  };
}

async function generateOpenAnswer(
  field: SemanticField,
  classification: Classification,
  sensitive: boolean,
  isChoice: boolean,
  settings: AutofillSettings,
  hooks: PlannerHooks
): Promise<{ answer: string; confidence: number } | null> {
  if (!hooks.generateAnswer || !settings.generateAIAnswers) return null;
  if (sensitive || isChoice) return null;
  if (classification.confidence < 0.6 || classification.semanticField === 'unknown') return null;
  if (field.type !== 'textarea' && field.type !== 'text') return null;
  try {
    return await hooks.generateAnswer({
      field,
      semanticField: classification.semanticField,
      category: classification.category,
      question: primaryText(field),
    });
  } catch {
    return null;
  }
}

function fileDecision(
  semanticField: string,
  settings: AutofillSettings
): { decision: FillDecision; reason: string } {
  if (semanticField === 'resume') {
    return settings.autoUploadResume
      ? { decision: 'auto_fill', reason: 'resume upload enabled in settings' }
      : { decision: 'ask_user', reason: 'resume file must be confirmed by the user' };
  }
  return { decision: 'skip', reason: 'no configured file for this upload field' };
}

function buildReviewItem(
  field: SemanticField,
  classification: Classification,
  value: string | null,
  confidence: number,
  reason: string
): ReviewItem {
  return {
    fieldId: field.id,
    label: primaryText(field) || field.name || 'Unlabelled field',
    semanticField: classification.semanticField,
    currentValue: '',
    suggestedValue: value ?? '',
    confidence,
    reason,
    category: classification.category,
    editable: true,
  };
}

async function planField(
  field: SemanticField,
  profile: CandidateProfile,
  settings: AutofillSettings,
  hooks: PlannerHooks
): Promise<PlannedFill> {
  const base = {
    fieldId: field.id,
    fingerprint: field.fingerprint,
    selector: field.selector,
    label: primaryText(field) || field.name || field.selector,
    sensitive: false,
    value: null as string | null,
    valueSource: null as PlanValueSource | null,
  };

  if (!field.visible || field.disabled) {
    return {
      ...base,
      kind: 'value',
      semanticField: 'unknown',
      category: 'unknown',
      classification: classifyField(field),
      decision: 'skip',
      confidence: 0,
      reason: field.disabled ? 'field is disabled' : 'field is not visible',
    };
  }

  const classification = await classifyWithFallback(field, hooks);
  const semanticField = classification.semanticField;
  const isCheckbox = field.type === 'checkbox' || field.role === 'checkbox';
  const declarationText = [primaryText(field), field.surroundingText ?? ''].join(' ');
  /**
   * Legal declarations ("I certify that all information is accurate") are
   * treated as sensitive even when the classifier reads them as ordinary
   * fields, so they can never be accepted automatically.
   */
  const declaration = isCheckbox && isLegalDeclaration(declarationText);
  const sensitive = isSensitiveKey(semanticField) || declaration;
  const isChoice = (field.type !== undefined && CHOICE_TYPES.has(field.type)) || (field.options?.length ?? 0) > 0;

  if (classification.category === 'file_upload') {
    const { decision, reason } = fileDecision(semanticField, settings);
    return {
      ...base,
      kind: 'file',
      semanticField,
      category: classification.category,
      sensitive,
      classification,
      decision,
      confidence: classification.confidence,
      reason,
      ...(decision !== 'skip'
        ? { review: buildReviewItem(field, classification, null, classification.confidence, reason) }
        : {}),
    };
  }

  const contextText = primaryText(field);
  const rawMatch = resolveValue(semanticField, profile, contextText);
  const match = resolveChoiceValue(field, rawMatch);

  let value = match.value;
  let valueSource: PlanValueSource | null = value !== null ? match.source : null;
  let confidence = classification.confidence;
  let reason = rawMatch.value !== null ? match.reason : classification.reason;

  if (value === null) {
    const generated = await generateOpenAnswer(
      field,
      classification,
      sensitive,
      isChoice,
      settings,
      hooks
    );
    if (generated) {
      value = generated.answer;
      valueSource = 'ai_generated';
      confidence = Math.min(classification.confidence, generated.confidence);
      reason = `AI-generated answer (${generated.confidence.toFixed(2)}): no stored value for ${semanticField}`;
    }
  }

  const decision = decideFill({
    confidence,
    sensitive,
    hasValue: value !== null,
    autoFillHighConfidence: settings.autoFillHighConfidence,
    requireConfirmation: settings.requireConfirmationMediumConfidence,
    skipSensitiveFields: settings.skipSensitiveFields,
  });

  const action: PlannedFill = {
    ...base,
    kind: 'value',
    semanticField,
    category: classification.category,
    sensitive,
    classification,
    decision,
    value,
    valueSource,
    confidence,
    reason,
    ...(rawMatch.profilePath ? { candidatePath: rawMatch.profilePath } : {}),
  };

  if (declaration && decision !== 'skip') {
    action.reason = 'legal declaration — requires explicit user confirmation';
  }

  if (decision === 'ask_user' || decision === 'fill_highlight') {
    action.review = buildReviewItem(field, classification, value, confidence, action.reason);
  }

  return action;
}

function toMapping(action: PlannedFill): FieldMapping {
  const status: FieldMapping['status'] =
    action.decision === 'skip'
      ? 'skipped'
      : action.decision === 'ask_user' || action.decision === 'fill_highlight'
        ? 'needs_review'
        : action.value === null
          ? 'failed'
          : 'matched';

  return {
    fieldId: action.fieldId,
    semanticField: action.semanticField,
    ...(action.candidatePath ? { candidatePath: action.candidatePath } : {}),
    ...(action.value !== null ? { value: action.value } : {}),
    confidence: action.confidence,
    ...(action.valueSource ? { source: action.valueSource } : {}),
    status,
  };
}

export async function buildFillPlan(
  fields: SemanticField[],
  profile: CandidateProfile,
  settings: AutofillSettings,
  hooks: PlannerHooks = {}
): Promise<FillPlan> {
  const actions: PlannedFill[] = [];
  for (const field of fields) {
    actions.push(await planField(field, profile, settings, hooks));
  }

  const summary: FillPlanSummary = {
    total: actions.length,
    autoFill: actions.filter((a) => a.decision === 'auto_fill').length,
    fillHighlight: actions.filter((a) => a.decision === 'fill_highlight').length,
    askUser: actions.filter((a) => a.decision === 'ask_user').length,
    skip: actions.filter((a) => a.decision === 'skip').length,
    sensitive: actions.filter((a) => a.sensitive).length,
    unknown: actions.filter((a) => a.semanticField === 'unknown').length,
    aiClassified: actions.filter((a) => a.classification.method === 'ai').length,
  };

  return { actions, mappings: actions.map(toMapping), summary };
}
