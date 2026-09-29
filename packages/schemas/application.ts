export interface ApplicationSession {
  id: string;
  url: string;
  title: string;
  startedAt: string;
  updatedAt: string;
  formAnalysis?: FormAnalysis;
  filledFields: FilledField[];
  status: 'analyzing' | 'ready' | 'filling' | 'filled' | 'review' | 'completed' | 'error';
  jobContext?: JobContext;
}

export interface FilledField {
  fieldId: string;
  semanticField: string;
  value: string;
  confidence: number;
  method: 'deterministic' | 'synonym' | 'heuristic' | 'ai' | 'cache' | 'user';
  status: 'success' | 'failed' | 'skipped' | 'needs_review';
  timestamp: string;
  error?: string;
}

export interface AutofillResult {
  success: boolean;
  filledCount: number;
  failedCount: number;
  skippedCount: number;
  needsReviewCount: number;
  fields: FilledField[];
  errors: string[];
}

export interface FieldMapping {
  fieldId: string;
  semanticField: string;
  candidateValue: string;
  confidence: number;
  source: 'profile' | 'saved_answer' | 'ai_generated' | 'user_input';
  profilePath?: string;
}

export interface ReviewItem {
  fieldId: string;
  label: string;
  semanticField: string;
  currentValue: string;
  suggestedValue: string;
  confidence: number;
  reason: string;
  category: string;
  editable: boolean;
}

export interface AutofillSettings {
  autoFillHighConfidence: boolean;
  requireConfirmationMediumConfidence: boolean;
  generateAIAnswers: boolean;
  highlightUncertainFields: boolean;
  autoUploadResume: boolean;
  skipSensitiveFields: boolean;
  debugMode: boolean;
}

export const DEFAULT_AUTOFILL_SETTINGS: AutofillSettings = {
  autoFillHighConfidence: true,
  requireConfirmationMediumConfidence: true,
  generateAIAnswers: true,
  highlightUncertainFields: true,
  autoUploadResume: false,
  skipSensitiveFields: true,
  debugMode: false,
};