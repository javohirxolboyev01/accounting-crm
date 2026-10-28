// API javob tiplari (backend DTO'lariga mos)
export type Role = 'LEADER' | 'ACCOUNTANT';
export type Lang = 'uz' | 'ru';
export type TaxType = 'AOS' | 'QQS';
export type ClientStatus = 'ACTIVE' | 'ZERO_REPORT' | 'LIQUIDATING';
export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'WAITING_CLIENT' | 'DONE' | 'CANCELLED';
export type TaskKind = 'ROUTINE' | 'REPORT' | 'URGENT' | 'MANUAL';
export type NotificationKind = 'TASK_DONE' | 'TASK_OVERDUE' | 'URGENT_TASK';

export interface Me {
  id: number;
  role: Role;
  fullName: string;
  login: string;
  language: Lang;
  active: boolean;
  telegramLinked: boolean;
  notificationPrefs: Partial<Record<NotificationKind, { app?: boolean; telegram?: boolean }>>;
  telegramBotEnabled?: boolean;
  telegramBotUsername?: string | null;
}

export interface User {
  id: number;
  role: Role;
  fullName: string;
  login: string;
  language: Lang;
  active: boolean;
  telegramLinked: boolean;
  createdAt: string;
}

export interface AccountantOption {
  id: number;
  fullName: string;
  openCount: number;
}

export interface Client {
  id: number;
  stir: string;
  name: string;
  contactPerson: string | null;
  phone: string | null;
  taxType: TaxType;
  taxTypeEffectiveFrom: string | null;
  accountantId: number | null;
  accountantName: string | null;
  status: ClientStatus;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  openTasks?: number;
  overdueTasks?: number;
  /** Faqat rahbarga keladi */
  monthlyFee?: number | null;
  /** Buxgalter ulushi (oylik to'lov x foiz), serverda hisoblanadi */
  accountantShare: number | null;
  bankKey: boolean | null;
  employeeCount: number | null;
  mehnatCheckedAt: string | null;
  mehnatLogin: string | null;
  hasMehnatPassword: boolean;
}

export interface ClientCard extends Client {
  taxHistory: { id: number; taxType: TaxType; effectiveFrom: string; createdAt: string; createdByName: string | null }[];
  dividendQuarters: string[];
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Task {
  id: number;
  clientId: number;
  clientName: string;
  clientStir: string;
  kind: TaskKind;
  routineTypeId: number | null;
  reportTypeId: number | null;
  reportCode: string | null;
  reportNameRu: string | null;
  routineNameRu: string | null;
  isFreeText: boolean;
  period: string;
  title: string;
  note: string | null;
  assigneeId: number | null;
  assigneeName: string | null;
  dueAt: string | null;
  status: TaskStatus;
  doneAt: string | null;
  doneBy: number | null;
  createdAt: string;
  updatedAt: string;
  overdue: boolean;
  dueSoon: boolean;
  waitingClient: boolean;
  onTime: boolean | null;
  checklistTotal: number;
  checklistDone: number;
  timerStartedAt: string | null;
  spentSec: number;
}

export interface TaskDetail extends Task {
  checklist: { id: number; text: string; done: boolean; sortOrder: number }[];
  timeEntries: { id: number; userId: number; userName: string; startedAt: string; endedAt: string | null }[];
}

export interface MyDay {
  period: string;
  groups: { today: Task[]; urgent: Task[]; overdue: Task[] };
  columns: Record<'TODO' | 'IN_PROGRESS' | 'WAITING_CLIENT' | 'DONE', Task[]>;
  stats: { done: number; doneOnTime: number; doneToday: number; open: number; overdue: number };
}

export type CellState = '1' | '0' | '!' | 'X';

export interface GridColumn {
  reportTypeId: number;
  code: string;
  name: string;
  nameRu: string;
  dueDay: number | null;
  dueDate: string | null;
  createsAccountantTask: boolean;
}

export interface GridRow {
  clientId: number;
  stir: string;
  name: string;
  taxType: TaxType;
  status: ClientStatus;
  note: string | null;
  accountantId: number | null;
  accountantName: string | null;
  cells: Record<number, { state: CellState; taskId: number | null; taskStatus: TaskStatus | null }>;
}

export interface Grid {
  period: string;
  columns: GridColumn[];
  rows: GridRow[];
}

/** Oylik ishlar ("Бухгалтер ишлари"): katakda "qaysi oygacha bajarilgan" (works.ts) */
export type WorkTone = 'done' | 'waiting' | 'overdue' | 'soon';

export interface WorkColumn {
  routineTypeId: number;
  name: string;
  nameRu: string;
  reportTypeId: number | null;
  isFreeText: boolean;
  shortName: string | null;
  shortNameRu: string | null;
  group: string | null;
  groupRu: string | null;
}

export interface WorkCell {
  na: boolean;
  /** 'YYYY-MM' */
  doneThrough: string | null;
  baseline: string | null;
  lag: number;
  tone: WorkTone | null;
  next: { kind: 'TASK'; taskId: number; status: TaskStatus; month: string } | { kind: 'BASELINE'; month: string } | null;
}

export interface WorksRow {
  clientId: number;
  stir: string;
  name: string;
  taxType: TaxType;
  status: ClientStatus;
  note: string | null;
  accountantId: number | null;
  accountantName: string | null;
  monthlyFee?: number | null;
  accountantShare: number | null;
  bankKey: boolean | null;
  employeeCount: number | null;
  mehnatCheckedAt: string | null;
  mehnatLogin: string | null;
  hasMehnatPassword: boolean;
  cells: Record<number, WorkCell>;
}

export interface Works extends Paged<WorksRow> {
  columns: WorkColumn[];
  /** Joriy oy 'YYYY-MM' */
  month: string;
  sharePercent: number;
}

export type AdvanceResult =
  | { kind: 'TASK'; task: Task }
  | { kind: 'BASELINE'; month: string; workName: string; workNameRu: string; clientName: string };

export interface ReportType {
  id: number;
  code: string;
  name: string;
  nameRu: string;
  frequency: 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
  dueDay: number | null;
  generationMonths: number[] | null;
  appliesToAos: boolean;
  appliesToQqs: boolean;
  createsAccountantTask: boolean;
  requiresDividendFlag: boolean;
  sheetAliases: string[];
  active: boolean;
  sortOrder: number;
}

export interface RoutineWork {
  id: number;
  name: string;
  nameRu: string;
  sortOrder: number;
  active: boolean;
  reportTypeId: number | null;
  isFreeText: boolean;
  effectiveFrom: string;
}

export interface UrgentTemplate {
  id: string;
  text: string;
}

export interface AppNotification {
  id: number;
  kind: NotificationKind;
  payload: Record<string, any>;
  taskId: number | null;
  deliverAt: string;
  deliveredAt: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface AuditItem {
  id: number;
  entity: string;
  entityId: string | null;
  clientId: number | null;
  clientName: string | null;
  action: string;
  before: unknown;
  after: unknown;
  at: string;
  actorId: number | null;
  actorName: string | null;
}

export interface DashboardClients {
  period: string;
  summary: {
    clients: number;
    ready: number;
    inProgress: number;
    overdue: number;
    tasksTotal: number;
    tasksDone: number;
    tasksOverdue: number;
    percent: number;
  };
  clients: {
    clientId: number;
    name: string;
    stir: string;
    status: ClientStatus;
    taxType: TaxType;
    accountantId: number | null;
    accountantName: string | null;
    total: number;
    done: number;
    overdue: number;
    waiting: number;
    percent: number | null;
    state: 'NONE' | 'READY' | 'OVERDUE' | 'IN_PROGRESS';
  }[];
  overdueTasks: {
    id: number;
    title: string;
    kind: TaskKind;
    dueAt: string;
    status: TaskStatus;
    clientId: number;
    clientName: string;
    assigneeId: number | null;
    assigneeName: string | null;
  }[];
}

export interface DashboardAccountants {
  from: string;
  to: string;
  accountants: {
    id: number;
    fullName: string;
    doneToday: number;
    doneWeek: number;
    doneMonth: number;
    done: number;
    onTime: number;
    onTimePercent: number | null;
    overdue: number;
    waiting: number;
    openTasks: number;
    clients: number;
    spentSec: number;
  }[];
}

export interface ImportReport {
  dryRun: boolean;
  period: string;
  columns: { header: string; code: string }[];
  summary: { total: number; created: number; updated: number; unchanged: number; skipped: number; review: number; cellsDone: number };
  rows: { row: number; stir: string; name: string; action: 'NEW' | 'UPDATED' | 'UNCHANGED' | 'SKIPPED'; changes: string[]; review: string[] }[];
  csv: string;
  alreadyImported: PreviousImport | null;
}

/** Shu fayl (mazmuni bo'yicha) avval import qilingan bo'lsa */
export interface PreviousImport {
  fileName: string;
  importedAt: string;
  importedBy: string | null;
}

export interface SheetsStatus {
  googleConfigured: boolean;
  defaultSpreadsheetId: string | null;
  intervalMinutes: number;
  states: {
    id: number;
    spreadsheetId: string;
    sheetTitle: string;
    month: string;
    enabled: boolean;
    lastSyncedAt: string | null;
    status: string;
    details: any;
  }[];
  errors: { id: number; kind: string; stateId: number; occurredAt: string; ref: string; stir: string | null; message: string; rawValue: string | null }[];
}

export interface ReviewItem {
  id: number;
  occurredAt: string;
  ref: string;
  stir: string | null;
  message: string;
  clientId: number | null;
}
