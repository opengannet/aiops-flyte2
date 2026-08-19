/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

export const uiText = {
  actions: "操作",
  addTrigger: "添加触发器",
  apps: "模型部署",
  associatedTask: "关联任务",
  automationType: "自动化类型",
  clearAll: "全部清除",
  code: "代码",
  codeRepositories: "代码库",
  completed: "已完成",
  cloudStorage: "云存储",
  copy: "复制",
  copyActionId: "复制操作 ID",
  copyActionUrl: "复制操作链接",
  copyLatestVersionNumber: "复制最新版本号",
  copyRunName: "复制运行名称",
  copyRunUrl: "复制运行链接",
  copyToClipboard: "复制到剪贴板",
  datasets: "数据集",
  developmentInstances: "开发实例",
  documentation: "文档",
  duration: "耗时",
  endTime: "结束时间",
  filter: "筛选：",
  home: "首页",
  input: "输入",
  labels: "标签",
  lastRun: "最近运行",
  lastUpdated: "最近更新",
  logs: "日志",
  metrics: "指标",
  name: "名称",
  newProject: "新建项目",
  noAutomation: "无自动化",
  noInputData: "无输入数据",
  noOutputData: "无输出数据",
  output: "输出",
  projects: "项目",
  reports: "报告",
  rerun: "重新运行",
  rerunAction: "重新运行操作",
  run: "运行",
  runId: "运行 ID",
  runInfo: "运行信息",
  runs: "运行",
  schedule: "计划",
  search: "搜索",
  searchProjects: "搜索项目",
  searchRuns: "搜索运行",
  searchTriggers: "搜索触发器",
  setup: "准备",
  startTime: "开始时间",
  status: "状态",
  summary: "摘要",
  task: "任务",
  tasks: "任务",
  trigger: "触发器",
  triggers: "触发器",
  trainingTasks: "训练任务",
  apiDocs: "API文档",
  userDocs: "用户文档",
  viewRunDetails: "查看运行详情",
} as const;

type UiTextKey = keyof typeof uiText;

export const getUiText = (key: UiTextKey) => uiText[key];

const dataLabelMap: Record<string, string> = {
  apps: uiText.apps,
  projects: uiText.projects,
  runs: uiText.runs,
  triggers: uiText.triggers,
  datasets: uiText.datasets,
  cloudStorages: uiText.cloudStorage,
  codeRepositories: uiText.codeRepositories,
};

export const translateDataLabel = (dataLabel: string) =>
  dataLabelMap[dataLabel] ?? dataLabel;

export const formatTotalLabel = (count: number | undefined) =>
  `共 ${count ?? 0} 个`;

export const formatRecentlyViewedLabel = (domainName: string | undefined) =>
  `最近查看（${domainName ?? ""}）`;

export const phaseLabels = {
  ABORTED: "已中止",
  FAILED: "失败",
  INITIALIZING: "初始化中",
  QUEUED: "排队中",
  RUNNING: "运行中",
  SUCCEEDED: "成功",
  TIMED_OUT: "已超时",
  UNSPECIFIED: "未知",
  WAITING_FOR_RESOURCES: "等待资源",
} as const;

export type PhaseLabelKey = keyof typeof phaseLabels;

export const getPhaseLabel = (phase: PhaseLabelKey) => phaseLabels[phase];
