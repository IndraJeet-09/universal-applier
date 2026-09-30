export type SkillCategory =
  | 'programmingLanguages'
  | 'frameworks'
  | 'databases'
  | 'cloud'
  | 'devops'
  | 'tools'
  | 'other';

const ALIASES: Record<string, string> = {
  js: 'JavaScript',
  ecmascript: 'JavaScript',
  es6: 'JavaScript',
  ts: 'TypeScript',
  node: 'Node.js',
  nodejs: 'Node.js',
  node_js: 'Node.js',
  reactjs: 'React',
  'react.js': 'React',
  vuejs: 'Vue.js',
  'vue.js': 'Vue',
  vue: 'Vue.js',
  angularjs: 'Angular',
  nextjs: 'Next.js',
  'next.js': 'Next.js',
  nuxtjs: 'Nuxt.js',
  expressjs: 'Express.js',
  express: 'Express.js',
  nestjs: 'NestJS',
  graphql: 'GraphQL',
  postgres: 'PostgreSQL',
  postgresql: 'PostgreSQL',
  mongo: 'MongoDB',
  mongodb: 'MongoDB',
  mysql: 'MySQL',
  redis: 'Redis',
  aws: 'AWS',
  'amazon web services': 'AWS',
  gcp: 'GCP',
  'google cloud': 'GCP',
  'google cloud platform': 'GCP',
  'azure': 'Microsoft Azure',
  docker: 'Docker',
  kubernetes: 'Kubernetes',
  k8s: 'Kubernetes',
  tf: 'Terraform',
  ci: 'CI/CD',
  'ci/cd': 'CI/CD',
  ml: 'Machine Learning',
  'nlp': 'NLP',
  'cv': 'Computer Vision',
  py: 'Python',
  cpp: 'C++',
  csharp: 'C#',
  'c sharp': 'C#',
  dotnet: '.NET',
  '.net': '.NET',
  go: 'Go',
  golang: 'Go',
  rb: 'Ruby',
  rails: 'Ruby on Rails',
  'ruby on rails': 'Ruby on Rails',
  springboot: 'Spring Boot',
  'spring boot': 'Spring Boot',
  tailwindcss: 'Tailwind CSS',
  'tailwind css': 'Tailwind CSS',
  'tailwind': 'Tailwind CSS',
  jsf: 'JSF',
  mongoatlas: 'MongoDB Atlas',
  github: 'GitHub',
  gitlab: 'GitLab',
  jira: 'Jira',
  figma: 'Figma',
  postman: 'Postman',
  linux: 'Linux',
  unix: 'UNIX',
  sql: 'SQL',
  nosql: 'NoSQL',
  rest: 'REST APIs',
  'rest api': 'REST APIs',
  'rest apis': 'REST APIs',
  'restful': 'REST APIs',
  'restful apis': 'REST APIs',
  jwt: 'JWT',
  oauth: 'OAuth',
  html5: 'HTML5',
  css3: 'CSS3',
  scss: 'SCSS',
  sass: 'Sass',
  webpack: 'Webpack',
  vite: 'Vite',
  redux: 'Redux',
  zustand: 'Zustand',
  'material ui': 'Material UI',
  mui: 'Material UI',
  pandas: 'pandas',
  numpy: 'NumPy',
  'tensorflow': 'TensorFlow',
  pytorch: 'PyTorch',
  'scikit-learn': 'scikit-learn',
  sklearn: 'scikit-learn',
  llm: 'LLMs',
  llms: 'LLMs',
  rag: 'RAG',
  webrtc: 'WebRTC',
  firebase: 'Firebase',
  supabase: 'Supabase',
  'electron.js': 'Electron',
  electron: 'Electron',
  reactnative: 'React Native',
  'react native': 'React Native',
  flutter: 'Flutter',
  swift: 'Swift',
  kotlin: 'Kotlin',
};

const CATEGORY_RULES: Array<{ category: SkillCategory; words: RegExp[] }> = [
  {
    category: 'programmingLanguages',
    words: [
      /^(javascript|typescript|python|java|c\+\+|c#|c|go|golang|rust|ruby|php|swift|kotlin|scala|haskell|elixir|erlang|perl|r|matlab|dart|lua|bash|shell|sql|html5?|css3?|scss|sass|objective-c|fortran|clojure|f#|vba|powershell)$/,
    ],
  },
  {
    category: 'frameworks',
    words: [
      /^(react|vue|angular|svelte|next\.?js|nuxt|express|fastify|koa|django|flask|fastapi|spring|spring boot|laravel|rails|ruby on rails|ASP\.NET|\.NET|node\.js|nest\.?js|graphql|redux|tailwind css|material ui|bootstrap|jquery|webpack|vite|jest|cypress|playwright|vitest|mocha|chai|pytest|unittest|kafka|rabbitmq|celery|streamlit|gradio|openai langchain|langchain|pandas|numpy|scikit-learn|tensorflow|pytorch|opencv|selenium|puppeteer)$/,
    ],
  },
  {
    category: 'databases',
    words: [
      /^(mysql|postgresql|mongodb|redis|cassandra|dynamodb|sqlite|mariadb|elasticsearch|oracle|sql server|microsoft sql|cockroachdb|influxdb|neo4j|firebase firestore|supabase)$/,
    ],
  },
  {
    category: 'cloud',
    words: [
      /^(aws|gcp|google cloud|azure|microsoft azure|vercel|netlify|heroku|cloudflare|openshift|linux|ubuntu|centos|nginx)$/,
    ],
  },
  {
    category: 'devops',
    words: [
      /^(docker|kubernetes|k8s|terraform|ansible|jenkins|github actions|gitlab ci|circleci|ci\/cd|helm|argocd|prometheus|grafana)$/,
    ],
  },
  {
    category: 'tools',
    words: [
      /^(git|github|gitlab|bitbucket|jira|confluence|figma|sketch|postman|swagger|slack|notion|trello|asana|linear|vs ?code|visual studio|intellij|eclipse|vim|docker desktop|splunk|datadog|grafana|kibana|sentry|new relic|zoom|azure devops)$/,
    ],
  },
];

export function canonicalSkill(raw: string): string | null {
  const trimmed = raw.trim().replace(/[.,;:]+$/, '');
  if (trimmed.length === 0 || trimmed.length > 60) return null;
  if (/^\d+$/.test(trimmed)) return null;

  const lower = trimmed.toLowerCase();
  if (ALIASES[lower]) return ALIASES[lower];

  const key = lower.replace(/[\s\-_.]/g, '');
  if (ALIASES[key]) return ALIASES[key];

  const titleCase = trimmed
    .split(/[\s\-_]+/)
    .map((w) => {
      if (w.length <= 5 && w === w.toUpperCase() && w !== w.toLowerCase()) return w;
      if (w.length <= 3 && !/[a-z]/.test(w)) return w.toUpperCase();
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(' ');
  return titleCase;
}

export function categorizeSkill(skill: string): SkillCategory {
  const lower = skill.toLowerCase().trim();
  for (const rule of CATEGORY_RULES) {
    if (rule.words.some((re) => re.test(lower))) return rule.category;
  }
  return 'other';
}

export function normalizeSkillList(rawSkills: string[]): {
  programmingLanguages: string[];
  frameworks: string[];
  databases: string[];
  cloud: string[];
  tools: string[];
  other: string[];
} {
  const buckets: Record<SkillCategory, Set<string>> = {
    programmingLanguages: new Set(),
    frameworks: new Set(),
    databases: new Set(),
    cloud: new Set(),
    tools: new Set(),
    other: new Set(),
  };

  for (const raw of rawSkills) {
    const canonical = canonicalSkill(raw);
    if (!canonical) continue;
    buckets[categorizeSkill(canonical)].add(canonical);
  }

  return {
    programmingLanguages: [...buckets.programmingLanguages],
    frameworks: [...buckets.frameworks],
    databases: [...buckets.databases],
    cloud: [...buckets.cloud],
    tools: [...buckets.tools],
    other: [...buckets.other],
  };
}

export function splitSkillLine(line: string): string[] {
  return line
    .split(/[,;•·]|\s\|\s|\s+and\s+|\s+&\s+/g)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= 60);
}