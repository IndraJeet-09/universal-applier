import { useEffect, useState } from 'react';
import type { CandidateProfile } from '@schemas/candidate';
import { EMPTY_CANDIDATE_PROFILE } from '@schemas/candidate';
import type { AutofillSettings } from '@schemas/application';
import { DEFAULT_AUTOFILL_SETTINGS } from '@schemas/application';
import { sendMessage } from '../utils/messaging';

type Tab = 'profile' | 'resume' | 'answers' | 'settings';

export default function App() {
  const [tab, setTab] = useState<Tab>('profile');
  const [profile, setProfile] = useState<CandidateProfile>(EMPTY_CANDIDATE_PROFILE);
  const [settings, setSettingsState] = useState<AutofillSettings>(DEFAULT_AUTOFILL_SETTINGS);

  useEffect(() => {
    void (async () => {
      try {
        const p = await sendMessage<void, CandidateProfile>('get-profile');
        if (p) setProfile(p);
        const s = await sendMessage<void, AutofillSettings>('get-settings');
        if (s) setSettingsState(s);
      } catch {
        /* first run, defaults are fine */
      }
    })();
  }, []);

  const updateSettings = (patch: Partial<AutofillSettings>) => {
    setSettingsState((prev) => ({ ...prev, ...patch }));
    void sendMessage('set-settings', patch);
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: 'profile', label: 'Candidate Profile' },
    { id: 'resume', label: 'Resume' },
    { id: 'answers', label: 'Saved Answers' },
    { id: 'settings', label: 'Settings' },
  ];

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Universal Job Autofill — Settings</h1>
        <span className="text-xs text-gray-500">
          {profile.personal.fullName || 'No profile'}
        </span>
      </header>

      <nav className="bg-white border-b border-gray-200 px-6 flex gap-4">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`py-2 text-sm border-b-2 -mb-px ${
              tab === t.id
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className="max-w-3xl mx-auto p-6 space-y-6">
        {tab === 'profile' && <ProfileTab profile={profile} />}
        {tab === 'resume' && <ResumeTab profile={profile} onProfileChange={setProfile} />}
        {tab === 'answers' && <AnswersTab answers={profile.applicationAnswers} />}
        {tab === 'settings' && <SettingsTab settings={settings} onChange={updateSettings} />}
      </main>
    </div>
  );
}

function ProfileTab({ profile }: { profile: CandidateProfile }) {
  const rows: [string, string][] = [
    ['Full Name', profile.personal.fullName],
    ['Email', profile.personal.email],
    ['Phone', profile.personal.phone ?? ''],
    ['Location', profile.personal.location ?? ''],
    ['Headline', profile.professional.headline ?? ''],
    ['Skills', profile.skills.programmingLanguages.concat(profile.skills.frameworks).join(', ')],
    ['Education', profile.education.map((e) => `${e.degree}, ${e.institution}`).join('; ')],
    ['Experience', profile.experience.map((e) => `${e.title} @ ${e.company}`).join('; ')],
    ['GitHub', profile.links.github ?? ''],
    ['LinkedIn', profile.links.linkedin ?? ''],
  ];

  return (
    <section className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
      {rows.map(([label, value]) => (
        <div key={label} className="grid grid-cols-3 gap-4 px-4 py-3">
          <div className="text-sm text-gray-500">{label}</div>
          <div className="col-span-2 text-sm">{value || <span className="text-gray-400">—</span>}</div>
        </div>
      ))}
    </section>
  );
}

function ResumeTab({
  profile,
  onProfileChange,
}: {
  profile: CandidateProfile;
  onProfileChange: (p: CandidateProfile) => void;
}) {
  const [status, setStatus] = useState<string | null>(null);

  const onFile = async (file: File) => {
    setStatus('Parsing resume…');
    try {
      const buf = await file.arrayBuffer();
      const updated = await sendMessage<{ buffer: ArrayBuffer; filename: string }, CandidateProfile>(
        'parse-resume',
        { buffer: buf, filename: file.name }
      );
      onProfileChange(updated);
      setStatus(`Parsed: ${updated.personal.fullName || 'name not found'} · ${updated.experience.length} roles · ${updated.education.length} education`);
    } catch (e) {
      setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <section className="space-y-4">
      <div className="bg-white border border-dashed border-gray-300 rounded-lg p-8 text-center">
        <label className="block cursor-pointer">
          <input
            type="file"
            accept=".pdf,.docx,.txt"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
            }}
          />
          <span className="text-sm text-gray-600">
            {profile.personal.fullName ? 'Replace resume' : 'Upload resume (PDF / DOCX)'}
          </span>
        </label>
        {status && <p className="mt-3 text-xs text-gray-600">{status}</p>}
      </div>
      {profile.metadata.source === 'resume' && (
        <p className="text-xs text-gray-500">
          Last parsed: {new Date(profile.metadata.parsedAt).toLocaleString()}
        </p>
      )}
    </section>
  );
}

function AnswersTab({ answers }: { answers: CandidateProfile['applicationAnswers'] }) {
  if (answers.length === 0) {
    return <p className="text-sm text-gray-500">No saved answers yet.</p>;
  }
  return (
    <section className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
      {answers.map((a) => (
        <div key={a.id} className="px-4 py-3">
          <div className="text-sm font-medium">{a.question}</div>
          <div className="text-sm text-gray-600">{a.answer}</div>
        </div>
      ))}
    </section>
  );
}

function SettingsTab({
  settings,
  onChange,
}: {
  settings: AutofillSettings;
  onChange: (patch: Partial<AutofillSettings>) => void;
}) {
  const toggles: { key: keyof AutofillSettings; label: string; description: string }[] = [
    { key: 'autoFillHighConfidence', label: 'Auto-fill known fields', description: 'Fill fields with confidence ≥ 0.95 without asking' },
    { key: 'requireConfirmationMediumConfidence', label: 'Confirm uncertain fields', description: 'Ask before filling fields with confidence 0.60–0.94' },
    { key: 'generateAIAnswers', label: 'Generate AI answers', description: 'Use AI for open-ended questions when configured' },
    { key: 'highlightUncertainFields', label: 'Highlight uncertain fields', description: 'Overlay borders on filled fields' },
    { key: 'autoUploadResume', label: 'Auto-attach configured resume', description: 'Fill file inputs when a resume file is configured' },
    { key: 'skipSensitiveFields', label: 'Skip sensitive fields', description: 'Never auto-answer demographic/legal questions' },
    { key: 'debugMode', label: 'Debug mode', description: 'Verbose console logging of detection and filling' },
  ];

  return (
    <section className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
      {toggles.map((t) => (
        <label key={t.key} className="flex items-start gap-3 px-4 py-3 cursor-pointer">
          <input
            type="checkbox"
            className="mt-1"
            checked={settings[t.key] as boolean}
            onChange={(e) => onChange({ [t.key]: e.target.checked } as Partial<AutofillSettings>)}
          />
          <span>
            <span className="text-sm font-medium block">{t.label}</span>
            <span className="text-xs text-gray-500">{t.description}</span>
          </span>
        </label>
      ))}
    </section>
  );
}