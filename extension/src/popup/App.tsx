import { useCallback, useEffect, useState } from 'react';
import { flattenSkills, type CandidateProfile } from '@schemas/candidate';
import type { FormAnalysis } from '@schemas/dom';
import type { AutofillSettings } from '@schemas/application';
import { DEFAULT_AUTOFILL_SETTINGS } from '@schemas/application';
import type { FillPlanSummary } from '../intelligence/fillPlanner';
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
  const [planSummary, setPlanSummary] = useState<FillPlanSummary | null>(null);

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
            try {
              const plan = await sendMessage<void, { summary: FillPlanSummary } | null>(
                'get-last-plan',
                undefined,
                { tabId: tab.id }
              );
              if (plan) setPlanSummary(plan.summary);
            } catch {
              /* no plan built yet */
            }
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

  const analyze = useCallback(async () => {
    if (!pageStatus.tabId) return;
    setBusy(true);
    setError(null);
    try {
      const analysis = await sendMessage<void, FormAnalysis>(
        'analyze-form',
        undefined,
        { tabId: pageStatus.tabId }
      );
      setPageStatus((s) => ({ ...s, analysis }));
      const plan = await sendMessage<void, { summary: FillPlanSummary }>(
        'build-fill-plan',
        undefined,
        { tabId: pageStatus.tabId }
      );
      setPlanSummary(plan.summary);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [pageStatus.tabId]);

  const openReview = useCallback(() => {
    if (!pageStatus.tabId) return;
    void sendMessage('show-summary-panel', undefined, { tabId: pageStatus.tabId }).catch((e) =>
      setError(e instanceof Error ? e.message : String(e))
    );
  }, [pageStatus.tabId]);

  const tabId = pageStatus.tabId;
  const hasResume = Boolean(profile?.personal?.fullName);
  const topSkills = flattenSkills(profile?.skills).slice(0, 8);
  const analysis = pageStatus.analysis;
  const job = analysis?.jobContext;
  const captcha = analysis?.captchaDetected;

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

        {captcha && (
          <div className="rounded-md bg-amber-50 border border-amber-300 text-amber-800 px-3 py-2 text-xs">
            CAPTCHA detected. Please complete it manually.
          </div>
        )}

        <div className="text-gray-600 text-xs">
          {analysis
            ? `${analysis.totalFields} fields detected · ${analysis.fillableFields} fillable`
            : pageStatus.error
              ? <span className="text-red-600">{pageStatus.error}</span>
              : 'Page not analyzed yet'}
        </div>

        {!planSummary ? (
          <button
            onClick={() => void analyze()}
            disabled={busy || !hasResume || !tabId}
            className="w-full rounded-md bg-blue-600 text-white py-2 font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? 'Analyzing…' : 'Autofill'}
          </button>
        ) : (
          <div className="rounded-md bg-gray-50 border border-gray-200 px-3 py-2 space-y-1.5">
            <div className="font-semibold">Application Detected</div>
            <div className="text-gray-700">{planSummary.total} fields</div>
            <div className="text-green-700">✓ {planSummary.autoFill} confident</div>
            <div className="text-amber-600">⚠ {planSummary.fillHighlight} uncertain</div>
            <div className="text-blue-700">? {planSummary.askUser} need input</div>
            {planSummary.skip > 0 && (
              <div className="text-gray-500">– {planSummary.skip} skipped</div>
            )}
            <button
              onClick={openReview}
              className="w-full mt-1 rounded-md bg-blue-600 text-white py-2 font-medium hover:bg-blue-700"
            >
              Review &amp; Fill
            </button>
            <div className="flex gap-2">
              <button
                onClick={() => void analyze()}
                disabled={busy}
                className="flex-1 rounded-md bg-white border border-gray-300 text-gray-700 py-1.5 text-xs hover:bg-gray-100 disabled:opacity-50"
              >
                {busy ? 'Rescanning…' : 'Rescan'}
              </button>
              <button
                onClick={() => setPlanSummary(null)}
                className="flex-1 rounded-md bg-white border border-gray-300 text-gray-700 py-1.5 text-xs hover:bg-gray-100"
              >
                Dismiss
              </button>
            </div>
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
              if (pageStatus.tabId) {
                void sendMessage('set-debug', { enabled: next }, { tabId: pageStatus.tabId }).catch(
                  () => {
                    /* content script may not be present on this page */
                  }
                );
              }
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
