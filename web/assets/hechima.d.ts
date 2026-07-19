// Hechima v0.11.1 — 変換セッション層 単体バンドルの型定義（手書き。cb 契約の明文化）。
// 要 KeymapEngine >= 1.2.0（onHostAction の convert/confirm/insertAndConfirm 転送）。
// 対応バンドル: hechima.js / hechima.min.js（UMD、グローバル名 `Hechima`）
//             + hechima-worker.js（Worker 本体、電文 v0。connectWorker で接続する）
// リファレンス: docs/hechima-session-embedding.md / docs/hechima-protocol.md
// （logical-layout-labo リポジトリ）

/** cb.show へ渡す表示文節。kind: yomi=未確定よみ / focus=注目文節 / other=非注目文節 */
export interface SegmentView {
  text: string;
  kind: "yomi" | "focus" | "other";
  /**
   * この文節の候補一覧（v0.5.0+、候補選択中 = kind focus/other のときのみ）。
   * 候補 UI（ポップアップ等）の描画用。読み取り専用（コピー）。
   * 表示値の重複は除去済み（v0.5.1+、初出順保持）。
   * 選択は selectCandidate() / Space / ↑↓ で行う。
   */
  candidates?: string[];
  /** candidates 内の現在選択位置（v0.5.0+、候補選択中のみ） */
  candidateIndex?: number;
  /**
   * 展開済みの追加候補（v0.6.0+、注目文節のみ）。通常候補の先頭で ↑（内蔵経路は Shift+Space も）
   * を押すたびに 1 つずつ展開される（ひらがな → カタカナ の順。KeyLogicKit / azooKey-Desktop 準拠）。
   * UI は通常候補の上に注釈付きで表示する。
   */
  additional?: { text: string; annotation: string }[];
  /** additional 内の選択位置（追加候補領域を選択中のみ。0 = 最上部） */
  additionalIndex?: number;
}

/** cb.convert が返す文節。candidates 省略/空は key をそのまま候補にする */
export interface ConvertSegment {
  key: string;
  candidates?: string[];
}

/**
 * ホストが実装するコールバック契約（5 点）。ホストごとの差し替え点はここに閉じる。
 *
 * - show(segments): 未確定表示を描画する（文節配列）。
 * - hide(): 表示消去（バッファが空になった）。
 * - commit(text): 確定文字列を出力する。呼び元が hide → 注入の順で処理する
 *   （例: QuuBee=SJIS 注入 / エディタ=挿入 / 試打サイト=追記）。
 * - hostKey(name): ホスト文書へ実キーを 1 打注入する（name = KeyboardEvent.code 名、
 *   例 'ArrowLeft' / 'Backspace'）。編集キーをバッファが空のときに実カーソル/BS へ
 *   橋渡しするための口。省略可。
 * - convert(yomi): かな→文節/候補のかな漢字変換（hechima-wasm 等を注入する差し替え点）。
 *   null/省略/失敗 = フォールバック（よみ 1 文節・カタカナ/ひらがな巡回）。
 * - resize(segmentIndex, offset): 文節伸縮（hechima-wasm v0.2.0+ の hechima_resize 等）。
 *   省略可。segmentIndex 文節のよみを offset（よみ文字数、±）だけ伸縮し再変換後の全文節を
 *   返す。null/空/失敗 = 伸縮不能（現状維持）。候補選択中の editSegmentLeft/Right
 *   （薙刀式 space+T/Y 等）がこれを使う。未提供なら editSegment* は無害に飲まれる。
 */
export interface SessionCallbacks {
  show(segments: SegmentView[]): void;
  hide(): void;
  commit(text: string): void;
  hostKey?(name: string): void;
  convert?(yomi: string): Promise<ConvertSegment[] | null> | ConvertSegment[] | null;
  resize?(segmentIndex: number, offset: number): Promise<ConvertSegment[] | null> | ConvertSegment[] | null;
  /**
   * 確定内容の学習通知（v0.8.0+、省略可・fire-and-forget）。候補選択中（Phase 2）の確定時に
   * 各文節の「よみ + 確定表示値」の列で呼ばれる（英字合成の確定では呼ばれない）。
   * connectWorker の callbacks() を繋げば Mozc の学習（候補選択 + 文節境界）に流れる。
   */
  learn?(segments: { key: string; value: string }[]): void;
  /**
   * 再変換（v0.10.0+、省略可）。確定済みの表記から逆変換でよみを求め、変換結果（keys がよみ）を返す。
   * null/省略/失敗 = 再変換不能。FepSession.reconvert() が使う。
   */
  reconvert?(surface: string): Promise<ConvertSegment[] | null> | ConvertSegment[] | null;
  /**
   * 確定アンドゥの文書側協力（v0.9.0+、省略可）。ホスト文書の末尾が text と一致するなら
   * それを取り除いて true（一致しない = その後に編集があった等なら false = アンドゥ不成立）。
   */
  retract?(text: string): boolean;
  /** 確定アンドゥ時の学習巻き戻し（v0.9.0+、省略可）。connectWorker の callbacks() で Mozc RevertConversion に流れる */
  unlearn?(): void;
}

/** feed / feedUp が読む KeyboardEvent 互換の最小形（DOM 型に依存しない） */
export interface KeyTap {
  /** KeyboardEvent.key（内蔵ローマ字経路はこれだけ読む） */
  key: string;
  /** KeyboardEvent.code（engine 経路の HID 変換と編集キー二重経路の判定に使う） */
  code?: string;
  repeat?: boolean;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
}

/** KeymapEngine の KeyEvent（構造互換。エンジン注入時のみ使う） */
export interface KeyEvent {
  keyCode: number;
  characters: string;
  modifiers: number;
}

/** setEngine に渡す KeyTap → KeyEvent 変換（KeymapEngine.keyEventFromBrowser がそのまま使える） */
export type KeyEventOf = (tap: KeyTap) => KeyEvent | null;

/**
 * KeymapEngine の InputEngine（構造互換の最小形）。
 * setEngine には `new KeymapEngine.InputEngine(...)` をそのまま渡す。
 * onHostAction は hechima が配線する（KeymapEngine >= 1.2.0 が必要。1.1.0 以前だと
 * Phase 2 の SandS 単打 convert が転送されず全角スペース挿入に化ける）。
 */
export interface InputEngineLike {
  processKey(event: KeyEvent): unknown;
  processKeyUp(event: KeyEvent): unknown;
  getState(): {
    composingKana: string;
    pendingDisplay: string;
    inputMode: string;
    isComposing: boolean;
  };
  takeConfirmedText(): string;
  reset(): void;
  onStateChange: (() => void) | null;
  onHostAction: ((action: { type: string }) => boolean) | null;
}

/** createFep が返すセッションオブジェクト（公開 API 契約） */
export interface FepSession {
  /** セッションが ON か */
  readonly active: boolean;
  /** ON/OFF を切り替える。OFF は未確定を破棄する。戻り値 = 新しい active */
  setActive(on: boolean): boolean;
  toggle(): boolean;
  /** keydown 1 個を消費する。true = 飲んだ（ホスト/ゲストへ送らない → preventDefault） */
  feed(e: KeyTap): boolean;
  /** keyup を消費する（SandS の単打 convert が発火する）。内蔵ローマ字経路は常に false */
  feedUp(e: KeyTap): boolean;
  /**
   * 配列エンジン（KeymapEngine の InputEngine）を注入する。null = 内蔵ローマ字。
   * engine.onStateChange → fep.pumpEngine() の配線はホスト側で行うこと。
   */
  setEngine(engine: InputEngineLike | null, keyOf?: KeyEventOf | null): void;
  /** engine.onStateChange（chord 窓満了）から呼ぶ */
  pumpEngine(): void;
  /**
   * 候補選択中（Phase 2）に注目文節の候補を直接選択する（v0.5.0+）。
   * ホストが候補 UI の数字キー/クリックから呼ぶ。範囲外・非 Phase 2 は false（現状維持）。
   */
  selectCandidate(index: number): boolean;
  /**
   * 確定アンドゥ（v0.9.0+、標準 IME の Ctrl+BS 相当。セッションも Ctrl+BS を内部割当）。
   * cb.retract の末尾一致が通ったときだけ成立し、学習も cb.unlearn で巻き戻る。
   */
  undoCommit(): boolean;
  /**
   * 再変換（v0.10.0+）: 確定済みの表記を候補選択状態として開き直す。ホストは呼ぶ前に
   * 文書から該当テキストを取り除いておく（false 時の復元もホスト責務）。cb.reconvert 必須。
   */
  reconvert(surface: string): Promise<boolean>;
  reset(): void;
}

/** 変換セッションを作る */
export function createFep(cb: SessionCallbacks): FepSession;

/** 内蔵ローマ字リゾルバ（テスト・診断用に公開） */
export function resolveRomaji(kana: string, pend: string, flush: boolean): { kana: string; pend: string };

/** フォールバック変換（よみ 1 文節・カタカナ/ひらがな巡回） */
export function fallbackConvert(yomi: string): ConvertSegment[];

/** このバンドルのバージョン（取り込み側が記録する用） */
export const version: string;

// ---- hechima-worker（電文 v0）。仕様の正典: docs/hechima-protocol.md ----

/** 電文プロトコル版数（ready.protocol と一致する） */
export const HECHIMA_PROTOCOL_VERSION: number;

/** 変換結果の 1 文節（電文ペイロード）。key = よみ、candidates = 候補（先頭が第一候補） */
export interface WireSegment {
  key: string;
  candidates: string[];
}

/** ホスト → Worker: 初期化。パスは worker スクリプト位置からの相対 URL（省略 = ./hechima-wasm.js / ./mozc.data）。learning 省略 = true、scope 省略 = "default"（v0.8.0+） */
export interface InitRequest { type: "init"; wasmJs?: string; dataUrl?: string; learning?: boolean; scope?: string }
/** ホスト → Worker: かな漢字変換 */
export interface ConvertRequest { type: "convert"; id: number; kana: string; maxCands?: number }
/** ホスト → Worker: 文節伸縮（worker が接続固有状態から境界制約に翻訳。v0.7.0+ はステートレス wasm 経由） */
export interface ResizeRequest { type: "resize"; id: number; segIdx: number; offset: number; maxCands?: number }
/** ホスト → Worker: 確定内容の学習（v0.8.0+。値はエンジン中立 = 表示値） */
export interface LearnRequest { type: "learn"; id: number; kana: string; sizes: number[]; values: string[] }
/** ホスト → Worker: OPFS の学習保存分を削除（v0.8.0+） */
export interface ClearLearningRequest { type: "clearLearning"; id: number }
/** ホスト → Worker: 直近の learn の取り消し（v0.9.0+。確定アンドゥの学習巻き戻し） */
export interface RevertRequest { type: "revert"; id: number }
/** ホスト → Worker: 再変換（v0.10.0+。表記 → 逆変換でよみ → 変換。応答は result で keys がよみ） */
export interface ReconvertRequest { type: "reconvert"; id: number; surface: string; maxCands?: number }
export type WorkerRequest = InitRequest | ConvertRequest | ResizeRequest | ReconvertRequest | LearnRequest | ClearLearningRequest | RevertRequest | DictListRequest | DictAddRequest | DictRemoveRequest;

/** Worker → ホスト: 辞書ダウンロード進捗（total 不明時は 0） */
export interface ProgressMessage { type: "progress"; loaded: number; total: number }
/** Worker → ホスト: 初期化完了。features.learn = 学習可、persist = OPFS 永続化可（v0.8.0+） */
export interface ReadyMessage { type: "ready"; protocol: number; version: string; features: { resize: boolean; learn?: boolean; persist?: boolean; dict?: boolean } }
/** Worker → ホスト: 初期化失敗 */
export interface ErrorMessage { type: "error"; message: string }
/** Worker → ホスト: convert / resize の結果。segments null = 結果なし（error は診断用付帯） */
export interface ResultMessage { type: "result"; id: number; segments: WireSegment[] | null; error?: string }
/** Worker → ホスト: learn / clearLearning の結果（v0.8.0+） */
export interface LearnedMessage { type: "learned"; id: number; ok: boolean }
/** ユーザー辞書の 1 項目（v0.11.0+。pos = Mozc PosType: 名詞1/固有名詞4/人名5/地名9 等） */
export interface DictEntry { reading: string; word: string; pos: number }
/** ホスト → Worker: 辞書一覧 / 登録 / 削除（v0.11.0+。応答は dict = 更新後の一覧） */
export interface DictListRequest { type: "dictList"; id: number }
export interface DictAddRequest { type: "dictAdd"; id: number; reading: string; word: string; pos?: number }
export interface DictRemoveRequest { type: "dictRemove"; id: number; index: number }
/** Worker → ホスト: 辞書操作の結果（entries = 一覧。失敗は null + error） */
export interface DictMessage { type: "dict"; id: number; entries: DictEntry[] | null; error?: string }
export type WorkerResponse = ProgressMessage | ReadyMessage | ErrorMessage | ResultMessage | LearnedMessage | DictMessage;

/** Worker の構造互換（DOM の Worker がそのまま渡せる） */
export interface HechimaWorkerLike {
  postMessage(m: WorkerRequest): void;
  addEventListener(type: "message", listener: (ev: { data: WorkerResponse }) => void): void;
}

export interface ConnectWorkerOptions {
  /** 文節あたりの最大候補数（既定 9） */
  maxCands?: number;
  /** 辞書ダウンロード進捗 */
  onProgress?: (loaded: number, total: number) => void;
}

export interface WorkerInitPaths {
  wasmJs?: string;
  dataUrl?: string;
  /** 学習（記録 + OPFS 永続化）。省略 = true（v0.8.0+） */
  learning?: boolean;
  /** 学習の保存スコープ（OPFS ディレクトリ名）。省略 = "default"（v0.8.0+） */
  scope?: string;
}

/** init 完了時の情報（ready 電文の中身） */
export interface ReadyInfo {
  protocol: number;
  version: string;
  features: { resize: boolean; learn?: boolean; persist?: boolean; dict?: boolean };
}

export interface WorkerConnection {
  /** 初期化を開始する。2 回目以降は最初の Promise を返す */
  init(paths?: WorkerInitPaths): Promise<ReadyInfo>;
  /** かな→文節/候補。ready まで待機して送る。失敗・init 失敗時は null（cb.convert 互換） */
  convert(yomi: string): Promise<ConvertSegment[] | null>;
  /** 文節伸縮。wasm 未対応（features.resize=false）・失敗時は null（cb.resize 互換） */
  resize(segmentIndex: number, offset: number): Promise<ConvertSegment[] | null>;
  /** 確定内容の学習（v0.8.0+）。true = 学習した（対応が取れない場合は false = 無害な no-op） */
  learn(segments: { key: string; value: string }[]): Promise<boolean>;
  /** 再変換（v0.10.0+、cb.reconvert 互換）。不能・未対応は null */
  reconvert(surface: string): Promise<ConvertSegment[] | null>;
  /** 直近の learn の取り消し（v0.9.0+ = 確定アンドゥの学習巻き戻し） */
  revert(): Promise<boolean>;
  /** OPFS の学習保存分を削除（v0.8.0+。メモリ内の学習は再ロードまで残る） */
  clearLearning(): Promise<boolean>;
  /** ユーザー辞書の一覧（v0.11.0+）。未対応は null */
  dictList(): Promise<DictEntry[] | null>;
  /** ユーザー辞書へ登録（v0.11.0+。pos 省略 = 名詞 = 1）。成功 = 更新後の一覧 */
  dictAdd(reading: string, word: string, pos?: number): Promise<DictEntry[] | null>;
  /** ユーザー辞書から削除（一覧の index）。成功 = 更新後の一覧 */
  dictRemove(index: number): Promise<DictEntry[] | null>;
  /** createFep の cb にスプレッドできる形: { ...conn.callbacks(), show, hide, commit } */
  callbacks(): {
    convert: (yomi: string) => Promise<ConvertSegment[] | null>;
    resize: (segmentIndex: number, offset: number) => Promise<ConvertSegment[] | null>;
    reconvert: (surface: string) => Promise<ConvertSegment[] | null>;
    learn: (segments: { key: string; value: string }[]) => void;
    unlearn: () => void;
  };
}

/**
 * hechima-worker（hechima-worker.js を読んだ Worker）へ接続する。
 * id 相関・ready 待機・resize 機能検出をここに閉じる。
 */
export function connectWorker(worker: HechimaWorkerLike, opts?: ConnectWorkerOptions): WorkerConnection;

export as namespace Hechima;
