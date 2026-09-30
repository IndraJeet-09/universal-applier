import { useCallback, useEffect, useState } from 'react';
import { flattenSkills, type CandidateProfile } from '@schemas/candidate';
import type { FormAnalysis } from '@schemas/dom';
import type { AutofillSettings, AutofillResult } from '@schemas/application';
import { DEFAULT_AUTOFILL_SETTINGS } from '@schemas/application';
import { sendMessage, getActiveTab } from '../utils/messaging';

interface PageStatus {
  tabId?: number;
  url?: string;
  analysis?: FormAnalysis;
  error?: string;
}

export default function App() {
  const [profile, setProfile] = useState<CandidateProfile | null>(null);
  const [settings, setSettings] = useState<AutofillSettings>(DEFAULT_AUTOFILL_SETTINGS);
  const [pageStatus, setPageStatus] = useState<PageStatus>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fillResult, setFillResult] = useState<AutofillResult | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const loadedProfile = await sendMessage<void, CandidateProfile>('get-profile');
        setProfile(loadedProfile);
        const loadedSettings = await sendMessage<void, AutofillSettings>('get-settings');
        setSettings(loadedSettings);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }

      try {
        const tab = await getActiveTab();
        if (tab?.id && tab.url) {
          setPageStatus((s) => ({ ...s, tabId: tab.id, url: tab.url }));
          const res = await sendMessage<void, { hasContentScript: boolean }>(
            'content-ping',
            undefined,
            { tabId: tab.id }
          );
          if (res?.hasContentScript) {
            const analysis = await sendMessage<void, FormAnalysis>(
              'analyze-form',
              undefined,
              { tabId: tab.id }
            );
            setPageStatus((s) => ({ ...s, analysis }));
          }
        }
      } catch (e) {
        setPageStatus((s) => ({
          ...s,
          error: e instanceof Error ? e.message : String(e),
        }));
      }
    })();
  }, []);

  const analyzeAndFill = useCallback(async () => {
    if (!pageStatus.tabId) return;
    setBusy(true);
    setError(null);
    setFillResult(null);
    try {
      const analysis = await sendMessage<void, FormAnalysis>(
        'analyze-form',
        undefined,
        { tabId: pageStatus.tabId }
      );
      setPageStatus((s) => ({ ...s, analysis }));

      await sendMessage<void, unknown>('build-fill-plan', undefined, {
        tabId: pageStatus.tabId,
      });
      const result = await sendMessage<void, AutofillResult>(
        'execute-fill',
        undefined,
        { tabId: pageStatus.tabId }
      );
      setFillResult(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [pageStatus.tabId]);

  const tabId = pageStatus.tabId;
  const hasResume = Boolean(profile?.personal?.fullName);
  const topSkills = flattenSkills(profile?.skills).slice(0, 8);
  const analysis = pageStatus.analysis;
  const job = analysis?.jobContext;

  return (
    <div className="w-80 bg-white text-gray-900 text-sm">
      <header className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
        <h1 className="font-semibold text-base">Universal Autofill</h1>
        <button
          onClick={() => void chrome.runtime.openOptionsPage()}
          className="text-xs text-gray-500 hover:text-gray-800"
        >
          Settings
        </button>
      </header>

      <main className="px-4 py-3 space-y-3">
        <div className="flex items-center gap-2">
          <span className={hasResume ? 'text-green-600' : 'text-gray-400'}>
            {hasResume ? '✓' : '○'}
          </span>
          <span>{hasResume ? 'Resume loaded' : 'No resume uploaded'}</span>
          {!hasResume && (
            <button
              onClick={() => void chrome.runtime.openOptionsPage()}
              className="ml-auto text-xs text-blue-600 hover:underline"
            >
              Upload
            </button>
          )}
        </div>

        {hasResume && profile && (
          <div className="rounded-md bg-gray-50 border border-gray-200 px-3 py-2 space-y-2">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-gray-500">Candidate</div>
              <div className="font-medium truncate">{profile.personal.fullName}</div>
              {profile.professional.headline && (
                <div className="text-xs text-gray-600 truncate">{profile.professional.headline}</div>
              )}
            </div>
            {topSkills.length > 0 && (
              <div>
                <div className="text-[11px] uppercase tracking-wide text-gray-500">Skills</div>
                <div className="flex flex-wrap gap-1 mt-1">
                  {topSkills.map((skill) => (
                    <span
                      key={skill}
                      className="rounded bg-white border border-gray-200 px-1.5 py-0.5 text-xs text-gray-700"
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {job?.title && (
          <div className="rounded-md bg-gray-50 border border-gray-200 px-3 py-2">
            <div className="font-medium">{job.title}</div>
            {job.company && <div className="text-gray-600 text-xs">{job.company}</div>}
          </div>
        )}

        <div className="text-gray-600 text-xs">
          {analysis
            ? `${analysis.totalFields} fields detected · ${analysis.fillableFields} fillable`
            : pageStatus.error
              ? <span className="text-red-600">{pageStatus.error}</span>
              : 'Page not analyzed yet'}
        </div>

        <button
          onClick={() => void analyzeAndFill()}
          disabled={busy || !hasResume || !pageStatus.tabId}
          className="w-full rounded-md bg-blue-600 text-white py-2 font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? 'Analyzing…' : 'Analyze & Autofill'}
        </button>

        {fillResult && (
          <div className="rounded-md bg-gray-50 border border-gray-200 px-3 py-2 text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-gray-600">Filled</span>
              <span className="font-medium text-green-700">{fillResult.filledCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Needs review</span>
              <span className="font-medium text-amber-600">{fillResult.needsReviewCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Skipped</span>
              <span className="font-medium">{fillResult.skippedCount}</span>
            </div>
            {fillResult.failedCount > 0 && (
              <div className="flex justify-between">
                <span className="text-gray-600">Failed</span>
                <span className="font-medium text-red-600">{fillResult.failedCount}</span>
              </div>
            )}
            {fillResult.errors.length > 0 && (
              <ul className="text-red-600 list-disc pl-4 space-y-0.5">
                {fillResult.errors.slice(0, 3).map((err) => (
                  <li key={err}>{err}</li>
                ))}
              </ul>
            )}
            {fillResult.needsReviewCount > 0 && tabId != null && (
              <button
                onClick={() =>
                  void sendMessage(
                    'show-review-panel',
                    undefined,
                    { tabId }
                  ).catch((e) => setError(e instanceof Error ? e.message : String(e)))
                }
                className="w-full mt-1 rounded-md bg-amber-500 text-white py-1.5 font-medium hover:bg-amber-600"
              >
                Review {fillResult.needsReviewCount} fields in page
              </button>
            )}
          </div>
        )}

        {error && <div className="text-xs text-red-600">{error}</div>}

        <div className="border-t border-gray-200 pt-2 flex justify-between text-xs text-gray-600">
          <button
            onClick={() => void chrome.runtime.openOptionsPage()}
            className="hover:text-gray-900"
          >
            View Profile
          </button>
          <button
            onClick={() => {
              const next = !settings.debugMode;
              setSettings({ ...settings, debugMode: next });
              void sendMessage('set-settings', { debugMode: next });
            }}
            className="hover:text-gray-900"
          >
            Debug: {settings.debugMode ? 'On' : 'Off'}
          </button>
        </div>
      </main>
    </div>
  );
}