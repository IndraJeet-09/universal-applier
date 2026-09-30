import type { FormAnalysis, FieldCategory, JobContext } from '@schemas/dom';
import type { AutofillResult, AutofillSettings, FilledField } from '@schemas/application';
import type { CandidateProfile } from '@schemas/candidate';
import type { FieldClassificationInput, FieldClassificationOutput } from '@schemas/ai';
import { registerHandlers, sendMessage } from '../utils/messaging';
import { createLogger, setDebugMode } from '../utils/logger';
import { analyzeForm } from './semanticExtractor';
import { refreshRegistry, getRegistry } from './fieldRegistry';
import { observeFormChanges, stopObserving } from './mutationObserver';
import {
  buildFillPlan,
  type FillPlan,
  type PlannerHooks,
} from '../intelligence/fillPlanner';
import { executeFillPlan, applyUserEdit, type FileToUpload } from './formFiller';
import { createReviewPanel, type ReviewPanel } from './reviewPanel';
import type { Classification } from '../intelligence/fieldClassifier';

const log = createLogger('content');

let lastAnalysis: FormAnalysis | null = null;
let lastPlan: FillPlan | null = null;
let reviewPanel: ReviewPanel | null = null;
let observing = false;

type ClassifyRequest = {
  field: FieldClassificationInput['field'];
  jobContext?: JobContext;
};

function slimField(field: {
  label?: string;
  placeholder?: string;
  name?: string;
  type?: string;
  options?: string[];
  surroundingText?: string;
  section?: string;
}): FieldClassificationInput['field'] {
  return {
    label: field.label,
    placeholder: field.placeholder,
    name: field.name,
    type: field.type,
    options: field.options,
    surroundingText: field.surroundingText,
    section: field.section,
  };
}

function createAiHooks(): PlannerHooks {
  return {
    async classifyWithAI(field): Promise<Classification | null> {
      try {
        const request: ClassifyRequest = {
          field: slimField(field),
          ...(lastAnalysis?.jobContext ? { jobContext: lastAnalysis.jobContext } : {}),
        };
        const out = await sendMessage<ClassifyRequest, FieldClassificationOutput | null>(
          'ai-classify',
          request
        );
        if (!out) return null;
        return {
          semanticField: out.semanticField,
          category: out.category as FieldCategory,
          confidence: out.confidence,
          method: 'ai',
          reason: out.reason,
        };
      } catch {
        return null;
      }
    },
    async generateAnswer({ question, semanticField, category }) {
      try {
        return await sendMessage<
          { question: string; semanticField: string; category: string; jobContext?: JobContext },
          { answer: string; confidence: number } | null
        >('ai-answer', {
          question,
          semanticField,
          category,
          jobContext: lastAnalysis?.jobContext ?? undefined,
        });
      } catch {
        return null;
      }
    },
  };
}

registerHandlers({
  async 'content-ping'() {
    return { hasContentScript: true, url: window.location.href };
  },

  async 'scan-fields'() {
    const fields = refreshRegistry();
    return { fields };
  },

  async 'analyze-form'() {
    const analysis = analyzeForm();
    lastAnalysis = analysis;
    refreshRegistry();
    startObserving();
    return analysis;
  },

  async 'get-last-analysis'() {
    return lastAnalysis;
  },

  async 'rescan-form'() {
    const fields = refreshRegistry();
    const analysis = analyzeForm();
    lastAnalysis = analysis;
    lastPlan = null;
    return { analysis, fields };
  },

  async 'get-registry'() {
    return {
      fields: getRegistry().map((e) => e.field),
    };
  },

  async 'set-debug'(payload: { enabled: boolean }) {
    setDebugMode(payload.enabled);
    return { enabled: payload.enabled };
  },

  async 'build-fill-plan'(): Promise<FillPlan> {
    const profile = await sendMessage<void, CandidateProfile>('get-profile');
    const settings = await sendMessage<void, AutofillSettings>('get-settings');
    refreshRegistry();
    const fields = getRegistry().map((entry) => entry.field);
    lastPlan = await buildFillPlan(fields, profile, settings, createAiHooks());
    log.info('fill plan built', lastPlan.summary);
    return lastPlan;
  },

  async 'get-last-plan'(): Promise<FillPlan | null> {
    return lastPlan;
  },

  async 'execute-fill'(payload?: { resumeFile?: FileToUpload }): Promise<AutofillResult> {
    if (!lastPlan) {
      throw new Error('no fill plan available; build one first');
    }
    const result = executeFillPlan(lastPlan, payload ?? {});
    log.info('fill executed', {
      filled: result.filledCount,
      failed: result.failedCount,
      needsReview: result.needsReviewCount,
    });
    return result;
  },

  async 'apply-review-edit'(payload: { fieldId: string; value: string }): Promise<FilledField> {
    if (!lastPlan) throw new Error('no fill plan available; build one first');
    const action = lastPlan.actions.find((a) => a.fieldId === payload.fieldId);
    if (!action) throw new Error(`unknown field ${payload.fieldId}`);
    const result = applyUserEdit(action, payload.value);
    if (result.status === 'success') {
      action.value = payload.value;
      action.decision = 'auto_fill';
    }
    return result;
  },

  async 'show-review-panel'(): Promise<{ count: number }> {
    if (!lastPlan) throw new Error('no fill plan available; build one first');
    reviewPanel?.destroy();
    reviewPanel = createReviewPanel(lastPlan, {
      onClose: () => {
        reviewPanel = null;
      },
    });
    document.documentElement.appendChild(reviewPanel.element);
    const count = reviewPanel.element.shadowRoot?.querySelectorAll('.item').length ?? 0;
    return { count };
  },

  async 'close-review-panel'(): Promise<{ closed: boolean }> {
    reviewPanel?.destroy();
    reviewPanel = null;
    return { closed: true };
  },
});

function startObserving(): void {
  if (observing) return;
  observing = true;
  observeFormChanges((mutations) => {
    const added = mutations.reduce((sum, m) => sum + m.addedNodes.length, 0);
    log.debug('dom changed, re-scanning', { addedNodes: added });
    const fields = refreshRegistry();
    void chrome.runtime
      .sendMessage({ type: 'content-fields-updated', payload: { count: fields.length } })
      .catch(() => {
        /* background may be asleep; not critical */
      });
  });
}

export function stopContentObserving(): void {
  stopObserving();
  observing = false;
}

log.info('content script loaded', { url: window.location.href });