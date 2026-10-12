export const NAV = [
  { id: 'home', label: '首页', icon: '1eb08.svg' },
  { id: 'timeline', label: '健康时间线', icon: '43a76.svg' },
  { id: 'card', label: '医生沟通卡', icon: 'e1fdd.svg' },
  { id: 'settings', label: '设置与数据', icon: '5180c.svg' },
];

const message = (role, text, action = null) => ({ role, text, action });
export const DEMO_SESSIONS = [
  { id: 'c1', title: '胃部不适与就诊准备', updatedAt: '2026-10-11T09:41:00', messages: [
    message('user', '饭后总腹胀，偶尔反酸，去医院前该准备什么？'),
    message('assistant', '先核对开始时间、频率和最近变化；相关记录我会一起整理。'),
    message('user', '还需要带什么资料？'),
    message('assistant', '已有两条相关记录。既往检查和近期用药尚未记录。'),
    message('user', '可以做成沟通卡吗？'),
    message('assistant', '可以。确认本次情况和相关历史后生成。', 'visit'),
  ] },
  { id: 'c2', title: '整理近期身体记录', updatedAt: '2026-10-08T10:30:00', messages: [
    message('user', '帮我整理最近一周的身体记录。'),
    message('assistant', '目前有两条胃部不适记录，先按时间排好。'),
    message('user', '最近一次是10月6日，饭后腹胀还有反酸。'),
    message('assistant', '已保存原话。开始时间和最近变化仍待你核对。', 'timeline'),
  ] },
  { id: 'c3', title: '补充症状信息', updatedAt: '2026-10-06T21:48:00', messages: [
    message('user', '饭后腹胀比前几天轻一些。'),
    message('assistant', '已记下变化。发作频率还未记录。'),
    message('user', '先这样，之后我再补充。'),
  ] },
];

export const INITIAL = {
  schemaVersion: 2,
  records: [
    { id: 'r2', created: '2026-10-06 09:30', date: '2026-10-06', text: '持续饭后腹胀，偶有反酸，较10月2日有所缓解。', status: 'confirmed', source: '用户自述', issue: '胃部不适' },
    { id: 'r1', created: '2026-10-06 21:48', date: '2026-10-02', text: '10月2日开始饭后腹胀，偶有反酸。', status: 'pending', source: '用户自述', issue: '胃部不适' },
  ],
  symptomStart: '2026-10-02',
  factVersion: 1,
  cardVersion: 1,
  cardStartDate: '2026-10-02',
  cardRecords: [
    { id: 'r2', date: '2026-10-06', text: '持续饭后腹胀，偶有反酸，较10月2日有所缓解。', source: '用户自述', status: 'confirmed' },
  ],
  cardDraft: '',
  cardConcern: '饭后腹胀，偶有反酸。',
  questions: ['需要补充哪些检查？', '就诊前需要准备什么？'],
  selectedHistory: ['r2', 'r1'],
  currentConcern: '饭后腹胀，偶有反酸。',
  recentChange: '仍有不适',
  impact: '',
  uploadedName: '',
  uploadState: 'empty',
  recordReviewed: false,
  taskStatus: 'pending',
  consent: { organize: true, parse: true, voice: false },
  exportAt: '2026-10-06',
  sessions: DEMO_SESSIONS,
  activeSessionId: null,
  factHistory: [],
  deleteResult: null,
};
