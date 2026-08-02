(function(global, factory) {
	typeof exports === "object" && typeof module !== "undefined" ? factory(exports) : typeof define === "function" && define.amd ? define(["exports"], factory) : (global = typeof globalThis !== "undefined" ? globalThis : global || self, factory(global.KeymapEngine = {}));
})(this, function(exports) {
	Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
	//#region src/engine/hid-key-codes.ts
	/** Named HID key codes (USB HID Usage Tables) */
	const HID = {
		A: 4,
		B: 5,
		C: 6,
		D: 7,
		E: 8,
		F: 9,
		G: 10,
		H: 11,
		I: 12,
		J: 13,
		K: 14,
		L: 15,
		M: 16,
		N: 17,
		O: 18,
		P: 19,
		Q: 20,
		R: 21,
		S: 22,
		T: 23,
		U: 24,
		V: 25,
		W: 26,
		X: 27,
		Y: 28,
		Z: 29,
		DIGIT_1: 30,
		DIGIT_2: 31,
		DIGIT_3: 32,
		DIGIT_4: 33,
		DIGIT_5: 34,
		DIGIT_6: 35,
		DIGIT_7: 36,
		DIGIT_8: 37,
		DIGIT_9: 38,
		DIGIT_0: 39,
		ENTER: 40,
		ESCAPE: 41,
		BACKSPACE: 42,
		TAB: 43,
		SPACE: 44,
		HYPHEN: 45,
		EQUAL: 46,
		BRACKET_LEFT: 47,
		BRACKET_RIGHT: 48,
		BACKSLASH: 49,
		SEMICOLON: 51,
		QUOTE: 52,
		BACKQUOTE: 53,
		COMMA: 54,
		PERIOD: 55,
		SLASH: 56,
		CAPS_LOCK: 57,
		F1: 58,
		F2: 59,
		F3: 60,
		F4: 61,
		F5: 62,
		F6: 63,
		F7: 64,
		F8: 65,
		F9: 66,
		F10: 67,
		F11: 68,
		F12: 69,
		ARROW_RIGHT: 79,
		ARROW_LEFT: 80,
		ARROW_DOWN: 81,
		ARROW_UP: 82,
		DELETE_FORWARD: 76,
		HOME: 74,
		END: 77,
		PAGE_UP: 75,
		PAGE_DOWN: 78,
		INTERNATIONAL_1: 135,
		INTERNATIONAL_2: 136,
		INTERNATIONAL_3: 137,
		INTERNATIONAL_4: 138,
		INTERNATIONAL_5: 139,
		LANG1: 144,
		LANG2: 145,
		RIGHT_ALT: 230
	};
	/** Browser KeyboardEvent.code → HID key code */
	const CODE_TO_HID = {
		KeyA: HID.A,
		KeyB: HID.B,
		KeyC: HID.C,
		KeyD: HID.D,
		KeyE: HID.E,
		KeyF: HID.F,
		KeyG: HID.G,
		KeyH: HID.H,
		KeyI: HID.I,
		KeyJ: HID.J,
		KeyK: HID.K,
		KeyL: HID.L,
		KeyM: HID.M,
		KeyN: HID.N,
		KeyO: HID.O,
		KeyP: HID.P,
		KeyQ: HID.Q,
		KeyR: HID.R,
		KeyS: HID.S,
		KeyT: HID.T,
		KeyU: HID.U,
		KeyV: HID.V,
		KeyW: HID.W,
		KeyX: HID.X,
		KeyY: HID.Y,
		KeyZ: HID.Z,
		Digit1: HID.DIGIT_1,
		Digit2: HID.DIGIT_2,
		Digit3: HID.DIGIT_3,
		Digit4: HID.DIGIT_4,
		Digit5: HID.DIGIT_5,
		Digit6: HID.DIGIT_6,
		Digit7: HID.DIGIT_7,
		Digit8: HID.DIGIT_8,
		Digit9: HID.DIGIT_9,
		Digit0: HID.DIGIT_0,
		Enter: HID.ENTER,
		Escape: HID.ESCAPE,
		Backspace: HID.BACKSPACE,
		Tab: HID.TAB,
		Space: HID.SPACE,
		Minus: HID.HYPHEN,
		Equal: HID.EQUAL,
		BracketLeft: HID.BRACKET_LEFT,
		BracketRight: HID.BRACKET_RIGHT,
		Backslash: HID.BACKSLASH,
		Semicolon: HID.SEMICOLON,
		Quote: HID.QUOTE,
		Backquote: HID.BACKQUOTE,
		Comma: HID.COMMA,
		Period: HID.PERIOD,
		Slash: HID.SLASH,
		CapsLock: HID.CAPS_LOCK,
		F1: HID.F1,
		F2: HID.F2,
		F3: HID.F3,
		F4: HID.F4,
		F5: HID.F5,
		F6: HID.F6,
		F7: HID.F7,
		F8: HID.F8,
		F9: HID.F9,
		F10: HID.F10,
		F11: HID.F11,
		F12: HID.F12,
		ArrowRight: HID.ARROW_RIGHT,
		ArrowLeft: HID.ARROW_LEFT,
		ArrowDown: HID.ARROW_DOWN,
		ArrowUp: HID.ARROW_UP,
		Delete: HID.DELETE_FORWARD,
		Home: HID.HOME,
		End: HID.END,
		PageUp: HID.PAGE_UP,
		PageDown: HID.PAGE_DOWN,
		IntlRo: HID.INTERNATIONAL_1,
		IntlYen: HID.INTERNATIONAL_3,
		NonConvert: HID.INTERNATIONAL_5,
		Convert: HID.INTERNATIONAL_4,
		Lang1: HID.LANG1,
		Lang2: HID.LANG2,
		AltRight: HID.RIGHT_ALT
	};
	function browserCodeToHID(code) {
		return CODE_TO_HID[code];
	}
	/** HID usage name (JSON keymap format) → HID key code */
	const NAME_TO_HID = {
		a: HID.A,
		b: HID.B,
		c: HID.C,
		d: HID.D,
		e: HID.E,
		f: HID.F,
		g: HID.G,
		h: HID.H,
		i: HID.I,
		j: HID.J,
		k: HID.K,
		l: HID.L,
		m: HID.M,
		n: HID.N,
		o: HID.O,
		p: HID.P,
		q: HID.Q,
		r: HID.R,
		s: HID.S,
		t: HID.T,
		u: HID.U,
		v: HID.V,
		w: HID.W,
		x: HID.X,
		y: HID.Y,
		z: HID.Z,
		"1": HID.DIGIT_1,
		"2": HID.DIGIT_2,
		"3": HID.DIGIT_3,
		"4": HID.DIGIT_4,
		"5": HID.DIGIT_5,
		"6": HID.DIGIT_6,
		"7": HID.DIGIT_7,
		"8": HID.DIGIT_8,
		"9": HID.DIGIT_9,
		"0": HID.DIGIT_0,
		enter: HID.ENTER,
		escape: HID.ESCAPE,
		backspace: HID.BACKSPACE,
		delete: HID.DELETE_FORWARD,
		tab: HID.TAB,
		space: HID.SPACE,
		capsLock: HID.CAPS_LOCK,
		hyphen: HID.HYPHEN,
		equal: HID.EQUAL,
		bracketLeft: HID.BRACKET_LEFT,
		bracketRight: HID.BRACKET_RIGHT,
		backslash: HID.BACKSLASH,
		semicolon: HID.SEMICOLON,
		quote: HID.QUOTE,
		backquote: HID.BACKQUOTE,
		comma: HID.COMMA,
		period: HID.PERIOD,
		slash: HID.SLASH,
		arrowRight: HID.ARROW_RIGHT,
		arrowLeft: HID.ARROW_LEFT,
		arrowDown: HID.ARROW_DOWN,
		arrowUp: HID.ARROW_UP,
		home: HID.HOME,
		end: HID.END,
		pageUp: HID.PAGE_UP,
		pageDown: HID.PAGE_DOWN,
		f1: HID.F1,
		f2: HID.F2,
		f3: HID.F3,
		f4: HID.F4,
		f5: HID.F5,
		f6: HID.F6,
		f7: HID.F7,
		f8: HID.F8,
		f9: HID.F9,
		f10: HID.F10,
		f11: HID.F11,
		f12: HID.F12,
		international1: HID.INTERNATIONAL_1,
		international2: HID.INTERNATIONAL_2,
		international3: HID.INTERNATIONAL_3,
		international4: HID.INTERNATIONAL_4,
		international5: HID.INTERNATIONAL_5,
		nonConvert: HID.INTERNATIONAL_5,
		convert: HID.INTERNATIONAL_4,
		lang1: HID.LANG1,
		lang2: HID.LANG2,
		rightAlt: HID.RIGHT_ALT
	};
	function hidNameToCode(name) {
		return NAME_TO_HID[name];
	}
	/** HID key code → usage name */
	const HID_TO_NAME = {};
	for (const [name, code] of Object.entries(NAME_TO_HID)) HID_TO_NAME[code] = name;
	function hidCodeToName(code) {
		return HID_TO_NAME[code];
	}
	/** HID key code → browser KeyboardEvent.code (reverse of CODE_TO_HID) */
	const HID_TO_BROWSER = {};
	for (const [code, hid] of Object.entries(CODE_TO_HID)) if (!HID_TO_BROWSER[hid]) HID_TO_BROWSER[hid] = code;
	/** HID usage name → browser code */
	function hidNameToBrowserCode(name) {
		const hid = NAME_TO_HID[name];
		return hid !== void 0 ? HID_TO_BROWSER[hid] : void 0;
	}
	const HID_TO_US_LEGEND = {
		[HID.A]: "a",
		[HID.B]: "b",
		[HID.C]: "c",
		[HID.D]: "d",
		[HID.E]: "e",
		[HID.F]: "f",
		[HID.G]: "g",
		[HID.H]: "h",
		[HID.I]: "i",
		[HID.J]: "j",
		[HID.K]: "k",
		[HID.L]: "l",
		[HID.M]: "m",
		[HID.N]: "n",
		[HID.O]: "o",
		[HID.P]: "p",
		[HID.Q]: "q",
		[HID.R]: "r",
		[HID.S]: "s",
		[HID.T]: "t",
		[HID.U]: "u",
		[HID.V]: "v",
		[HID.W]: "w",
		[HID.X]: "x",
		[HID.Y]: "y",
		[HID.Z]: "z",
		[HID.DIGIT_1]: "1",
		[HID.DIGIT_2]: "2",
		[HID.DIGIT_3]: "3",
		[HID.DIGIT_4]: "4",
		[HID.DIGIT_5]: "5",
		[HID.DIGIT_6]: "6",
		[HID.DIGIT_7]: "7",
		[HID.DIGIT_8]: "8",
		[HID.DIGIT_9]: "9",
		[HID.DIGIT_0]: "0",
		[HID.HYPHEN]: "-",
		[HID.EQUAL]: "=",
		[HID.BRACKET_LEFT]: "[",
		[HID.BRACKET_RIGHT]: "]",
		[HID.BACKSLASH]: "\\",
		[HID.SEMICOLON]: ";",
		[HID.QUOTE]: "'",
		[HID.BACKQUOTE]: "`",
		[HID.COMMA]: ",",
		[HID.PERIOD]: ".",
		[HID.SLASH]: "/"
	};
	/** HID コード → US 刻印の 1 文字。表に無ければ undefined */
	function hidToUsLegend(code) {
		return HID_TO_US_LEGEND[code];
	}
	//#endregion
	//#region src/engine/diagnostics.ts
	/** 診断を配列に溜めるだけの sink（テストと、まとめて受け取りたいホスト向け） */
	function collectDiagnostics() {
		const items = [];
		return {
			sink: (d) => items.push(d),
			items
		};
	}
	const REASON_TO_CODE = {
		"not-allowed-here": "action-not-allowed-here",
		unsupported: "action-unsupported",
		unknown: "action-unknown",
		extension: "action-extension-ignored",
		"bad-param": "action-bad-param"
	};
	const REASON_TO_MESSAGE = {
		"not-allowed-here": "この面では書けないアクションです",
		unsupported: "このランタイムに実装が無いアクションです",
		unknown: "未知のアクション名です",
		extension: "アプリ固有アクション（x-）なので無視しました",
		"bad-param": "アクションのパラメータが不正です"
	};
	/** parseKeyActionResult の reason を診断に変換して報告する */
	function reportActionRejection(sink, reason, where, key, value) {
		if (!sink) return;
		sink({
			code: REASON_TO_CODE[reason],
			message: `${REASON_TO_MESSAGE[reason]}: "${value}"（${where} の ${key}）`,
			where,
			key,
			value
		});
	}
	//#endregion
	//#region src/engine/gamepad-kana-table.ts
	/** LT後置シフトマップ: 子音かな→拗音, 母音→小書き */
	const YOUON_POSTSHIFT_MAP = /* @__PURE__ */ new Map([
		["あ", "ぁ"],
		["い", "ぃ"],
		["う", "ぅ"],
		["え", "ぇ"],
		["お", "ぉ"],
		["や", "ゃ"],
		["ゆ", "ゅ"],
		["よ", "ょ"],
		["わ", "ゎ"],
		["か", "きゃ"],
		["く", "きゅ"],
		["こ", "きょ"],
		["さ", "しゃ"],
		["す", "しゅ"],
		["そ", "しょ"],
		["た", "ちゃ"],
		["つ", "ちゅ"],
		["と", "ちょ"],
		["な", "にゃ"],
		["ぬ", "にゅ"],
		["の", "にょ"],
		["は", "ひゃ"],
		["ふ", "ひゅ"],
		["ほ", "ひょ"],
		["ま", "みゃ"],
		["む", "みゅ"],
		["も", "みょ"],
		["ら", "りゃ"],
		["る", "りゅ"],
		["ろ", "りょ"],
		["が", "ぎゃ"],
		["ぐ", "ぎゅ"],
		["ご", "ぎょ"],
		["ざ", "じゃ"],
		["ず", "じゅ"],
		["ぞ", "じょ"],
		["だ", "ぢゃ"],
		["づ", "ぢゅ"],
		["ど", "ぢょ"],
		["ば", "びゃ"],
		["ぶ", "びゅ"],
		["ぼ", "びょ"],
		["ぱ", "ぴゃ"],
		["ぷ", "ぴゅ"],
		["ぽ", "ぴょ"]
	]);
	/** 濁点変換マップ */
	const DAKUTEN_MAP = /* @__PURE__ */ new Map([
		["か", "が"],
		["き", "ぎ"],
		["く", "ぐ"],
		["け", "げ"],
		["こ", "ご"],
		["さ", "ざ"],
		["し", "じ"],
		["す", "ず"],
		["せ", "ぜ"],
		["そ", "ぞ"],
		["た", "だ"],
		["ち", "ぢ"],
		["つ", "づ"],
		["て", "で"],
		["と", "ど"],
		["は", "ば"],
		["ひ", "び"],
		["ふ", "ぶ"],
		["へ", "べ"],
		["ほ", "ぼ"],
		["う", "ゔ"]
	]);
	/** 半濁点変換マップ */
	const HANDAKUTEN_MAP = /* @__PURE__ */ new Map([
		["は", "ぱ"],
		["ひ", "ぴ"],
		["ふ", "ぷ"],
		["へ", "ぺ"],
		["ほ", "ぽ"]
	]);
	/** 濁点逆引き（濁音→清音） */
	const DAKUTEN_REVERSE = new Map([...DAKUTEN_MAP.entries()].map(([k, v]) => [v, k]));
	/** 半濁点逆引き（半濁音→清音） */
	const HANDAKUTEN_REVERSE = new Map([...HANDAKUTEN_MAP.entries()].map(([k, v]) => [v, k]));
	//#endregion
	//#region src/engine/postmodify.ts
	const POST_MODIFY_OPS = [
		"cycle",
		"cycleDakuten",
		"dakuten",
		"handakuten",
		"small"
	];
	/**
	* サイクルの既定表。iOS 標準 12 キーの「゛゜小」と同系列（押すたびに次へ、末尾 → 先頭）。
	* flickmap は `postModifyCycles` で完全置換できる。
	*/
	const DEFAULT_POST_MODIFY_CYCLES = [
		"かが",
		"きぎ",
		"くぐ",
		"けげ",
		"こご",
		"さざ",
		"しじ",
		"すず",
		"せぜ",
		"そぞ",
		"ただ",
		"ちぢ",
		"つっづ",
		"てで",
		"とど",
		"はばぱ",
		"ひびぴ",
		"ふぶぷ",
		"へべぺ",
		"ほぼぽ",
		"あぁ",
		"いぃ",
		"うぅゔ",
		"えぇ",
		"おぉ",
		"やゃ",
		"ゆゅ",
		"よょ",
		"わゎ"
	];
	/** tail（末尾 1 字）の次のトグル字。どのサイクルにも無ければ null */
	function nextPostModify(tail, cycles) {
		for (const cycle of cycles) {
			const chars = Array.from(cycle);
			const i = chars.indexOf(tail);
			if (i >= 0) return chars[(i + 1) % chars.length];
		}
		return null;
	}
	/**
	* 濁点キー（方向つき）。清音↔濁音のトグルで、半濁音からは濁音へ。
	*
	* - か→が / が→か（トグル）
	* - は→ば / ば→は（トグル）
	* - ぱ→ば（半濁点を濁点に差し替え）
	*/
	function applyDakuten(tail) {
		const seionFromHandakuten = HANDAKUTEN_REVERSE.get(tail);
		if (seionFromHandakuten) return DAKUTEN_MAP.get(seionFromHandakuten) ?? seionFromHandakuten;
		const seionFromDakuten = DAKUTEN_REVERSE.get(tail);
		if (seionFromDakuten) return seionFromDakuten;
		return DAKUTEN_MAP.get(tail) ?? null;
	}
	/**
	* 半濁点キー（方向つき）。清音↔半濁音のトグルで、濁音からは半濁音へ。
	*
	* - は→ぱ / ぱ→は（トグル）
	* - ば→ぱ（濁点を半濁点に差し替え）
	*/
	function applyHandakuten(tail) {
		const seionFromHandakuten = HANDAKUTEN_REVERSE.get(tail);
		if (seionFromHandakuten) return seionFromHandakuten;
		const seion = DAKUTEN_REVERSE.get(tail) ?? tail;
		return HANDAKUTEN_MAP.get(seion) ?? null;
	}
	/**
	* 濁点キー 1 本で全部を回す（か→が→か / は→ば→ぱ→は）。
	* ゲームパッド経路が従来から使っている挙動。
	*/
	function cycleDakuten(tail) {
		const seionFromHandakuten = HANDAKUTEN_REVERSE.get(tail);
		if (seionFromHandakuten) return seionFromHandakuten;
		const seionFromDakuten = DAKUTEN_REVERSE.get(tail);
		if (seionFromDakuten) return HANDAKUTEN_MAP.get(seionFromDakuten) ?? seionFromDakuten;
		return DAKUTEN_MAP.get(tail) ?? null;
	}
	/** 小書きをトグルする（や↔ゃ） */
	function applySmall(tail) {
		return YOUON_POSTSHIFT_MAP.get(tail) ?? null;
	}
	/**
	* 末尾 1 字に後置変調を適用した結果を返す。適用できなければ null。
	*
	* **対象は「合成テキストの末尾 1 字」で、その正は合成テキストの所有者が持つ**
	* （docs/keymap-v2-requirements.md D4）。呼び出し側が所有者から末尾を取って渡すこと。
	*/
	function postModify(tail, op, cycles = DEFAULT_POST_MODIFY_CYCLES) {
		switch (op) {
			case "cycle": return nextPostModify(tail, cycles);
			case "cycleDakuten": return cycleDakuten(tail);
			case "dakuten": return applyDakuten(tail);
			case "handakuten": return applyHandakuten(tail);
			case "small": return applySmall(tail);
		}
	}
	//#endregion
	//#region src/engine/key-action-parser.ts
	const FULL_VOCAB = [
		"convert",
		"confirm",
		"cancel",
		"deleteBack",
		"moveLeft",
		"moveRight",
		"moveUp",
		"moveDown",
		"editSegmentLeft",
		"editSegmentRight",
		"switchToEnglish",
		"switchToJapanese",
		"toggleInputMode",
		"insertAndConfirm",
		"directInsert",
		"insertSpace",
		"postModify",
		"pass"
	];
	const SURFACE_VOCAB = {
		"keymap.specialActions": FULL_VOCAB,
		"keymap.englishSpecialActions": FULL_VOCAB,
		"keymap.singleTapAction": FULL_VOCAB,
		"keymap.modeKeys": [
			"switchToEnglish",
			"switchToJapanese",
			"toggleInputMode",
			"postModify",
			"pass"
		]
	};
	const UNSUPPORTED_VOCAB = [
		"convertPrev",
		"confirmHiragana",
		"confirmKatakana",
		"confirmHalfWidthKatakana",
		"confirmFullWidthRoman",
		"confirmHalfWidthRoman",
		"selectCandidate"
	];
	const PHASES = [
		"idle",
		"composing",
		"selecting"
	];
	/** ガード付きオブジェクト形式 `{ action, when }` を素の値に分解する */
	function unwrap(value) {
		if (typeof value === "string") return { str: value };
		if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
		const o = value;
		if (typeof o.action !== "string") return null;
		if (o.when === void 0) return { str: o.action };
		if (!Array.isArray(o.when) || o.when.length === 0) return null;
		if (o.when.some((p) => typeof p !== "string" || !PHASES.includes(p))) return null;
		return {
			str: o.action,
			when: o.when
		};
	}
	/** その局面でアクションが有効か。ガードが無ければ常に有効 */
	function isActiveIn(when, phase) {
		return when === void 0 || when.includes(phase);
	}
	/** パラメータ付きアクション（"名前:パラメータ" 形式）の組み立て */
	function withParam(name, param) {
		switch (name) {
			case "insertAndConfirm": return param ? {
				type: "insertAndConfirm",
				text: param
			} : null;
			case "directInsert": return param ? {
				type: "directInsert",
				text: param
			} : null;
			case "insertSpace": return param === "shifted" ? {
				type: "insertSpace",
				shifted: true
			} : null;
			case "postModify": return POST_MODIFY_OPS.includes(param) ? {
				type: "postModify",
				op: param
			} : null;
			default: return null;
		}
	}
	function withoutParam(name) {
		switch (name) {
			case "convert": return { type: "convert" };
			case "confirm": return { type: "confirm" };
			case "cancel": return { type: "cancel" };
			case "deleteBack": return { type: "deleteBack" };
			case "moveLeft": return { type: "moveLeft" };
			case "moveRight": return { type: "moveRight" };
			case "moveUp": return { type: "moveUp" };
			case "moveDown": return { type: "moveDown" };
			case "editSegmentLeft": return { type: "editSegmentLeft" };
			case "editSegmentRight": return { type: "editSegmentRight" };
			case "switchToEnglish": return { type: "switchToEnglish" };
			case "switchToJapanese": return { type: "switchToJapanese" };
			case "toggleInputMode": return { type: "toggleInputMode" };
			case "insertSpace": return {
				type: "insertSpace",
				shifted: false
			};
			case "postModify": return {
				type: "postModify",
				op: "cycle"
			};
			case "pass": return { type: "pass" };
			default: return null;
		}
	}
	/**
	* アクション文字列を KeyAction に変換し、**できなかった場合は理由を返す**。
	*
	* 呼び出し側はこの理由を診断（`KeymapDiagnostic`）に変換してホストへ渡す。
	* v1.9.0 までは黙って捨てていた（`docs/keymap-v2-requirements.md` R3-4
	* 「潰すのは許す。黙るのを禁じる」）。
	*/
	function parseKeyActionResult(value, surface) {
		const unwrapped = unwrap(value);
		if (!unwrapped) return {
			ok: false,
			reason: "bad-param"
		};
		const { str, when } = unwrapped;
		const sep = str.indexOf(":");
		const name = sep === -1 ? str : str.slice(0, sep);
		const param = sep === -1 ? null : str.slice(sep + 1);
		if (name.startsWith("x-")) return {
			ok: false,
			reason: "extension"
		};
		if (!SURFACE_VOCAB[surface].includes(name)) {
			if (UNSUPPORTED_VOCAB.includes(name)) return {
				ok: false,
				reason: "unsupported"
			};
			return {
				ok: false,
				reason: Object.values(SURFACE_VOCAB).some((v) => v.includes(name)) ? "not-allowed-here" : "unknown"
			};
		}
		const action = param === null ? withoutParam(name) : withParam(name, param);
		if (action) return {
			ok: true,
			action,
			when
		};
		return {
			ok: false,
			reason: "bad-param"
		};
	}
	//#endregion
	//#region src/engine/semantics.ts
	const SUPPORTED_SEMANTICS = [
		"behavior:sequential",
		"behavior:chord",
		"judgment:window",
		"judgment:mutual",
		"inputBase:romaji",
		"suffixRules",
		"keyRemap",
		"modeKeys",
		"chord:shiftKeys",
		"chord:englishTables",
		"prefixShiftKeys",
		"requiresInput",
		"actionGuard",
		"postModify",
		"roles",
		"layouts",
		"positionalBase"
	];
	/**
	* `requires` を検証する。理解できない名前が 1 つでもあればエラー。
	*
	* **黙って無視してはならない**カテゴリ。`extensions` / `x-` の
	* 「安全に無視してよい」とはちょうど逆向きの契約。
	*/
	function assertRequiredSemantics(raw) {
		if (raw === void 0 || raw === null) return [];
		if (!Array.isArray(raw) || raw.some((x) => typeof x !== "string")) throw new Error("KeymapEngine: requires は文字列の配列である必要があります");
		const unknown = raw.filter((s) => !SUPPORTED_SEMANTICS.includes(s));
		if (unknown.length > 0) throw new Error(`KeymapEngine: 理解できないセマンティクスを要求しています: ${unknown.join(", ")}。このエンジンでは、この配列を意図どおりに動かせません`);
		return raw;
	}
	//#endregion
	//#region src/engine/types.ts
	/** Modifier key bit flags */
	const KeyModifierFlags = {
		SHIFT: 1,
		CONTROL: 2,
		ALT: 4,
		META: 8
	};
	//#endregion
	//#region src/engine/keymap-decoder.ts
	const KNOWN_FIELDS = /* @__PURE__ */ new Set([
		"$schema",
		"formatVersion",
		"requires",
		"requiresInput",
		"roles",
		"layouts",
		"base",
		"name",
		"description",
		"author",
		"contributor",
		"basedOn",
		"license",
		"addedAt",
		"keyboardLayout",
		"targetScript",
		"behavior",
		"controlBindings",
		"inputBase",
		"keyRemap",
		"suffixRules",
		"inputMappings",
		"prefixShiftKeys",
		"bufferDisplayMap",
		"modeKeys",
		"extensions"
	]);
	const IGNORED_FIELDS = /* @__PURE__ */ new Set(["controlBindings", "bufferDisplayMap"]);
	/** Parse a raw JSON object into a KeymapDefinition */
	function decodeKeymap$1(json, opts = {}) {
		assertKnownFields(json, opts);
		const behavior = json.behavior;
		if (!behavior || behavior.type !== "sequential" && behavior.type !== "chord") throw new Error(`Unsupported behavior type: ${behavior?.type}`);
		const modeKeys = decodeModeKeys(json.modeKeys, opts);
		const prefixShiftKeys = json.prefixShiftKeys;
		const common = {
			formatVersion: json.formatVersion || "1.0",
			requires: assertRequiredSemantics(json.requires),
			requiresInput: decodeInputLevel(json.requiresInput),
			name: json.name,
			description: json.description,
			author: json.author,
			contributor: json.contributor,
			basedOn: json.basedOn,
			license: json.license,
			keyboardLayout: json.keyboardLayout,
			roles: json.roles,
			layouts: json.layouts,
			base: decodeBase(json.base),
			targetScript: json.targetScript,
			inputBase: json.inputBase,
			keyRemap: json.keyRemap,
			suffixRules: json.suffixRules,
			inputMappings: filterComments(json.inputMappings),
			prefixShiftKeys,
			modeKeys,
			extensions: json.extensions
		};
		if (behavior.type === "chord") {
			const config = behavior.config;
			const chordConfig = {
				hidToKey: config.hidToKey ?? {},
				shiftKeys: config.shiftKeys ?? [],
				lookupTable: config.lookupTable ?? {},
				specialActions: config.specialActions ?? {},
				judgment: decodeJudgment(config.judgment),
				simultaneousWindow: config.simultaneousWindow ?? .1,
				englishLookupTable: config.englishLookupTable,
				englishSpecialActions: config.englishSpecialActions
			};
			return {
				...common,
				behavior: {
					type: "chord",
					config: chordConfig
				}
			};
		}
		const characterMap = {};
		const rawMap = behavior.characterMap;
		if (rawMap) {
			for (const [k, v] of Object.entries(rawMap)) if (k.length === 1 && v.length === 1) characterMap[k] = v;
			else if (!k.startsWith("_comment")) opts.onDiagnostic?.({
				code: "character-map-invalid",
				message: `characterMap は 1 文字 → 1 文字である必要があります: "${k}" → "${v}"`,
				where: "behavior.characterMap",
				key: k,
				value: v
			});
		}
		return {
			...common,
			behavior: {
				type: "sequential",
				characterMap
			}
		};
	}
	/** Decode modeKeys from JSON string keys like "ctrl+space" */
	function decodeModeKeys(raw, opts) {
		if (!raw) return [];
		const entries = [];
		for (const [keyStr, rawAction] of Object.entries(raw)) {
			if (keyStr.startsWith("_comment")) continue;
			const actionStr = typeof rawAction === "string" ? rawAction : JSON.stringify(rawAction);
			const trigger = decodeModeKeyTrigger(keyStr);
			if (!trigger) {
				opts.onDiagnostic?.({
					code: "mode-key-trigger-unknown",
					message: `modeKeys のキー名を解釈できません: "${keyStr}"`,
					where: "modeKeys",
					key: keyStr,
					value: actionStr
				});
				continue;
			}
			const parsed = parseKeyActionResult(rawAction, "keymap.modeKeys");
			if (!parsed.ok) {
				reportActionRejection(opts.onDiagnostic, parsed.reason, "modeKeys", keyStr, actionStr);
				continue;
			}
			entries.push({
				trigger,
				action: parsed.action,
				...parsed.when ? { when: parsed.when } : {}
			});
		}
		return entries;
	}
	/**
	* トップレベルのフィールドを検査する。
	*
	* - **未知のフィールド → エラー**（黙って飛ばして読まない）
	* - 既知だがこのランタイムが解釈しないフィールド → 診断で報告（読み込みは続ける）
	*/
	function assertKnownFields(json, opts) {
		const unknown = Object.keys(json).filter((k) => !KNOWN_FIELDS.has(k) && !k.startsWith("_comment"));
		if (unknown.length > 0) throw new Error(`KeymapEngine: 未知のフィールドがあります: ${unknown.join(", ")}。新しい仕様を要求する配列を、それを知らないエンジンで読もうとしています`);
		if (!opts.onDiagnostic) return;
		for (const k of Object.keys(json)) if (IGNORED_FIELDS.has(k)) opts.onDiagnostic({
			code: "field-ignored",
			message: `このランタイムは "${k}" を解釈しません（書いても効きません）`,
			where: "(トップレベル)",
			key: k
		});
	}
	/** base の未知値はエラー（既定へ潰さない） */
	function decodeBase(raw) {
		if (raw === void 0 || raw === null) return void 0;
		if (raw === "characters" || raw === "positional") return raw;
		throw new Error(`KeymapEngine: 非対応の base "${String(raw)}"（characters / positional のみ）`);
	}
	/** requiresInput の未知値はエラー（既定へ潰さない） */
	function decodeInputLevel(raw) {
		if (raw === void 0 || raw === null) return void 0;
		if (raw === "L1" || raw === "L2" || raw === "L3") return raw;
		throw new Error(`KeymapEngine: 非対応の requiresInput "${String(raw)}"（L1 / L2 / L3 のみ）`);
	}
	/** judgment の未知値は既定へ潰さずエラー（v1.10.0。旧版は黙って window にしていた） */
	function decodeJudgment(raw) {
		if (raw === void 0 || raw === null) return "window";
		if (raw === "window" || raw === "mutual") return raw;
		throw new Error(`KeymapEngine: 非対応の judgment "${String(raw)}"（"window" / "mutual" のみ）。新しい判定方式を要求する配列を、それを知らないエンジンで読もうとしています`);
	}
	/** Parse "ctrl+shift+j" → { keyCode, modifiers } */
	function decodeModeKeyTrigger(str) {
		const parts = str.split("+");
		let modifiers = 0;
		let keyNameIdx = 0;
		const modMap = {
			ctrl: KeyModifierFlags.CONTROL,
			shift: KeyModifierFlags.SHIFT,
			alt: KeyModifierFlags.ALT
		};
		for (let i = 0; i < parts.length; i++) {
			const mod = modMap[parts[i]];
			if (mod !== void 0) {
				modifiers |= mod;
				keyNameIdx = i + 1;
			} else break;
		}
		if (keyNameIdx >= parts.length) return null;
		const keyCode = hidNameToCode(parts.slice(keyNameIdx).join("+"));
		if (keyCode === void 0) return null;
		return {
			keyCode,
			modifiers
		};
	}
	/** Parse a KeyAction string from JSON */
	/** Filter out _comment keys from inputMappings */
	function filterComments(mappings) {
		if (!mappings) return void 0;
		const result = {};
		for (const [k, v] of Object.entries(mappings)) if (!k.startsWith("_comment")) result[k] = v;
		return Object.keys(result).length > 0 ? result : void 0;
	}
	//#endregion
	//#region src/engine/input-level.ts
	const ORDER = {
		L1: 1,
		L2: 2,
		L3: 3
	};
	/**
	* この配列を**このランタイムで**動かすのに必要な段を求める。
	*
	* - 逐次系 → L1（完結した打鍵列だけで意味が決まる）
	* - chord 系 → **L3**。仕様上は時間窓方式なら L2 で近似できるが、
	*   この実装は `window` でも単打確定を全キーリリースに置いている
	*   （`SimultaneousKeyBuffer` は heldKeys 駆動）ため、実際には keyup が要る
	*
	* JSON の `requiresInput` 宣言は**厳しくする方向にのみ**効く。緩める宣言
	* （実装が L3 を要るのに L1 と書く）を通すと、動かない配列を「動く」と誤って
	* 見せることになるため。
	*/
	function requiredInputLevel(def) {
		const derived = def.behavior.type === "chord" ? "L3" : "L1";
		const declared = def.requiresInput;
		if (declared && ORDER[declared] > ORDER[derived]) return declared;
		return derived;
	}
	/** ホストの段で、その配列が動くか */
	function isSatisfiedBy(required, hostLevel) {
		return ORDER[hostLevel] >= ORDER[required];
	}
	//#endregion
	//#region src/engine/roles.ts
	/**
	* 役名の別名。正規名は機能ベースで、身体部位の名前は可読性のために受理するだけ。
	* v1 の `leftThumb` / `rightThumb` / `space` からの書き換えを不要にする効果もある。
	*/
	const ROLE_ALIASES = {
		leftThumb: "holder1",
		rightThumb: "holder2"
	};
	/** 別名を正規名に直す */
	function canonicalRole(name) {
		return ROLE_ALIASES[name] ?? name;
	}
	/**
	* 役を解決する。
	*
	* @param layout どのレイアウトの追加バインドを適用するか（`layouts` のキー）。
	*               省略すると `layouts` は適用されない（役の既定候補だけ）
	* @param overrides ホストの実行時上書き。役 → 物理キー名の配列。
	*                  **指定された役は既定を置き換える**（追加ではない）
	*/
	function resolveRoles(def, layout, overrides) {
		const bindings = /* @__PURE__ */ new Map();
		const order = [];
		for (const [rawName, role] of Object.entries(def.roles ?? {})) {
			const name = canonicalRole(rawName);
			order.push(name);
			const override = overrides?.get(name);
			if (override) {
				bindings.set(name, [...new Set(override)]);
				continue;
			}
			const keys = [...role.keys ?? []];
			const extra = layout ? def.layouts?.[layout]?.[rawName] ?? def.layouts?.[layout]?.[name] : void 0;
			if (extra) keys.push(...extra);
			bindings.set(name, [...new Set(keys)]);
		}
		const keyToRole = /* @__PURE__ */ new Map();
		for (const name of order) for (const key of bindings.get(name) ?? []) if (!keyToRole.has(key)) keyToRole.set(key, name);
		return {
			bindings,
			keyToRole,
			order,
			unbound: order.filter((n) => (bindings.get(n) ?? []).length === 0)
		};
	}
	//#endregion
	//#region src/engine/standard-romaji.ts
	const standardRomajiTable = {
		a: "あ",
		i: "い",
		u: "う",
		e: "え",
		o: "お",
		ka: "か",
		ki: "き",
		ku: "く",
		ke: "け",
		ko: "こ",
		ca: "か",
		ci: "し",
		cu: "く",
		ce: "せ",
		co: "こ",
		sa: "さ",
		si: "し",
		shi: "し",
		su: "す",
		se: "せ",
		so: "そ",
		ta: "た",
		ti: "ち",
		chi: "ち",
		tu: "つ",
		tsu: "つ",
		te: "て",
		to: "と",
		na: "な",
		ni: "に",
		nu: "ぬ",
		ne: "ね",
		no: "の",
		ha: "は",
		hi: "ひ",
		hu: "ふ",
		he: "へ",
		ho: "ほ",
		ma: "ま",
		mi: "み",
		mu: "む",
		me: "め",
		mo: "も",
		ya: "や",
		yu: "ゆ",
		yo: "よ",
		ra: "ら",
		ri: "り",
		ru: "る",
		re: "れ",
		ro: "ろ",
		wa: "わ",
		wi: "うぃ",
		we: "うぇ",
		wo: "を",
		wyi: "ゐ",
		wye: "ゑ",
		whu: "う",
		ga: "が",
		gi: "ぎ",
		gu: "ぐ",
		ge: "げ",
		go: "ご",
		za: "ざ",
		zi: "じ",
		ji: "じ",
		zu: "ず",
		ze: "ぜ",
		zo: "ぞ",
		da: "だ",
		di: "ぢ",
		du: "づ",
		dzu: "づ",
		de: "で",
		do: "ど",
		ba: "ば",
		bi: "び",
		bu: "ぶ",
		be: "べ",
		bo: "ぼ",
		pa: "ぱ",
		pi: "ぴ",
		pu: "ぷ",
		pe: "ぺ",
		po: "ぽ",
		ye: "いぇ",
		kya: "きゃ",
		kyu: "きゅ",
		kye: "きぇ",
		kyo: "きょ",
		sya: "しゃ",
		syu: "しゅ",
		sye: "しぇ",
		syo: "しょ",
		sha: "しゃ",
		shu: "しゅ",
		she: "しぇ",
		sho: "しょ",
		tya: "ちゃ",
		tyi: "ちぃ",
		tyu: "ちゅ",
		tye: "ちぇ",
		tyo: "ちょ",
		cha: "ちゃ",
		chu: "ちゅ",
		che: "ちぇ",
		cho: "ちょ",
		cya: "ちゃ",
		cyi: "ちぃ",
		cyu: "ちゅ",
		cye: "ちぇ",
		cyo: "ちょ",
		nya: "にゃ",
		nyi: "にぃ",
		nyu: "にゅ",
		nye: "にぇ",
		nyo: "にょ",
		hya: "ひゃ",
		hyi: "ひぃ",
		hyu: "ひゅ",
		hye: "ひぇ",
		hyo: "ひょ",
		mya: "みゃ",
		myi: "みぃ",
		myu: "みゅ",
		mye: "みぇ",
		myo: "みょ",
		rya: "りゃ",
		ryi: "りぃ",
		ryu: "りゅ",
		rye: "りぇ",
		ryo: "りょ",
		gya: "ぎゃ",
		gyu: "ぎゅ",
		gye: "ぎぇ",
		gyo: "ぎょ",
		zya: "じゃ",
		zyu: "じゅ",
		zye: "じぇ",
		zyo: "じょ",
		ja: "じゃ",
		ju: "じゅ",
		je: "じぇ",
		jo: "じょ",
		jya: "じゃ",
		jyi: "じぃ",
		jyu: "じゅ",
		jye: "じぇ",
		jyo: "じょ",
		bya: "びゃ",
		byi: "びぃ",
		byu: "びゅ",
		bye: "びぇ",
		byo: "びょ",
		pya: "ぴゃ",
		pyi: "ぴぃ",
		pyu: "ぴゅ",
		pye: "ぴぇ",
		pyo: "ぴょ",
		dya: "ぢゃ",
		dyi: "ぢぃ",
		dyu: "ぢゅ",
		dye: "ぢぇ",
		dyo: "ぢょ",
		fa: "ふぁ",
		fi: "ふぃ",
		fu: "ふ",
		fe: "ふぇ",
		fo: "ふぉ",
		fya: "ふゃ",
		fyu: "ふゅ",
		fyo: "ふょ",
		fwa: "ふぁ",
		fwi: "ふぃ",
		fwu: "ふぅ",
		fwe: "ふぇ",
		fwo: "ふぉ",
		hwa: "ふぁ",
		hwi: "ふぃ",
		hwe: "ふぇ",
		hwo: "ふぉ",
		va: "ヴぁ",
		vi: "ヴぃ",
		vu: "ヴ",
		ve: "ヴぇ",
		vo: "ヴぉ",
		vya: "ゔゃ",
		vyu: "ゔゅ",
		vyo: "ゔょ",
		tha: "てゃ",
		thi: "てぃ",
		thu: "てゅ",
		the: "てぇ",
		tho: "てょ",
		dha: "でゃ",
		dhi: "でぃ",
		dhu: "でゅ",
		dhe: "でぇ",
		dho: "でょ",
		swa: "すぁ",
		swi: "すぃ",
		swu: "すぅ",
		swe: "すぇ",
		swo: "すぉ",
		twa: "とぁ",
		twi: "とぃ",
		twu: "とぅ",
		twe: "とぇ",
		two: "とぉ",
		dwa: "どぁ",
		dwi: "どぃ",
		dwu: "どぅ",
		dwe: "どぇ",
		dwo: "どぉ",
		tsa: "つぁ",
		tsi: "つぃ",
		tse: "つぇ",
		tso: "つぉ",
		wha: "うぁ",
		whi: "うぃ",
		whe: "うぇ",
		who: "うぉ",
		kwa: "くぁ",
		kwi: "くぃ",
		kwu: "くぅ",
		kwe: "くぇ",
		kwo: "くぉ",
		qa: "くぁ",
		qi: "くぃ",
		qu: "くぅ",
		qe: "くぇ",
		qo: "くぉ",
		qwa: "くぁ",
		qwi: "くぃ",
		qwu: "くぅ",
		qwe: "くぇ",
		qwo: "くぉ",
		gwa: "ぐぁ",
		gwi: "ぐぃ",
		gwu: "ぐぅ",
		gwe: "ぐぇ",
		gwo: "ぐぉ",
		xka: "ヵ",
		xke: "ヶ",
		lka: "ヵ",
		lke: "ヶ",
		n: "ん",
		nn: "ん",
		"n'": "ん",
		xn: "ん",
		kka: "っか",
		kki: "っき",
		kku: "っく",
		kke: "っけ",
		kko: "っこ",
		kkya: "っきゃ",
		kkyu: "っきゅ",
		kkye: "っきぇ",
		kkyo: "っきょ",
		kkwa: "っくぁ",
		kkwi: "っくぃ",
		kkwu: "っくぅ",
		kkwe: "っくぇ",
		kkwo: "っくぉ",
		ssa: "っさ",
		ssi: "っし",
		ssu: "っす",
		sse: "っせ",
		sso: "っそ",
		ssha: "っしゃ",
		sshi: "っし",
		sshu: "っしゅ",
		sshe: "っしぇ",
		ssho: "っしょ",
		ssya: "っしゃ",
		ssyu: "っしゅ",
		ssye: "っしぇ",
		ssyo: "っしょ",
		sswa: "っすぁ",
		sswi: "っすぃ",
		sswu: "っすぅ",
		sswe: "っすぇ",
		sswo: "っすぉ",
		tta: "った",
		tti: "っち",
		ttu: "っつ",
		tte: "って",
		tto: "っと",
		ttya: "っちゃ",
		ttyi: "っちぃ",
		ttyu: "っちゅ",
		ttye: "っちぇ",
		ttyo: "っちょ",
		tcha: "っちゃ",
		tchi: "っち",
		tchu: "っちゅ",
		tche: "っちぇ",
		tcho: "っちょ",
		ttsa: "っつぁ",
		ttsi: "っつぃ",
		ttse: "っつぇ",
		ttso: "っつぉ",
		ttha: "ってゃ",
		tthi: "ってぃ",
		tthu: "ってゅ",
		tthe: "ってぇ",
		ttho: "ってょ",
		ttwa: "っとぁ",
		ttwi: "っとぃ",
		ttwu: "っとぅ",
		ttwe: "っとぇ",
		ttwo: "っとぉ",
		hha: "っは",
		hhi: "っひ",
		hhu: "っふ",
		hhe: "っへ",
		hho: "っほ",
		hhya: "っひゃ",
		hhyi: "っひぃ",
		hhyu: "っひゅ",
		hhye: "っひぇ",
		hhyo: "っひょ",
		mma: "っま",
		mmi: "っみ",
		mmu: "っむ",
		mme: "っめ",
		mmo: "っも",
		mmya: "っみゃ",
		mmyi: "っみぃ",
		mmyu: "っみゅ",
		mmye: "っみぇ",
		mmyo: "っみょ",
		rra: "っら",
		rri: "っり",
		rru: "っる",
		rre: "っれ",
		rro: "っろ",
		rrya: "っりゃ",
		rryi: "っりぃ",
		rryu: "っりゅ",
		rrye: "っりぇ",
		rryo: "っりょ",
		gga: "っが",
		ggi: "っぎ",
		ggu: "っぐ",
		gge: "っげ",
		ggo: "っご",
		ggya: "っぎゃ",
		ggyu: "っぎゅ",
		ggye: "っぎぇ",
		ggyo: "っぎょ",
		ggwa: "っぐぁ",
		ggwi: "っぐぃ",
		ggwu: "っぐぅ",
		ggwe: "っぐぇ",
		ggwo: "っぐぉ",
		zza: "っざ",
		zzi: "っじ",
		zzu: "っず",
		zze: "っぜ",
		zzo: "っぞ",
		zzya: "っじゃ",
		zzyu: "っじゅ",
		zzye: "っじぇ",
		zzyo: "っじょ",
		dda: "っだ",
		ddi: "っぢ",
		ddu: "っづ",
		dde: "っで",
		ddo: "っど",
		ddzu: "っづ",
		ddya: "っぢゃ",
		ddyi: "っぢぃ",
		ddyu: "っぢゅ",
		ddye: "っぢぇ",
		ddyo: "っぢょ",
		ddha: "っでゃ",
		ddhi: "っでぃ",
		ddhu: "っでゅ",
		ddhe: "っでぇ",
		ddho: "っでょ",
		ddwa: "っどぁ",
		ddwi: "っどぃ",
		ddwu: "っどぅ",
		ddwe: "っどぇ",
		ddwo: "っどぉ",
		bba: "っば",
		bbi: "っび",
		bbu: "っぶ",
		bbe: "っべ",
		bbo: "っぼ",
		bbya: "っびゃ",
		bbyi: "っびぃ",
		bbyu: "っびゅ",
		bbye: "っびぇ",
		bbyo: "っびょ",
		ppa: "っぱ",
		ppi: "っぴ",
		ppu: "っぷ",
		ppe: "っぺ",
		ppo: "っぽ",
		ppya: "っぴゃ",
		ppyi: "っぴぃ",
		ppyu: "っぴゅ",
		ppye: "っぴぇ",
		ppyo: "っぴょ",
		ffa: "っふぁ",
		ffi: "っふぃ",
		ffu: "っふ",
		ffe: "っふぇ",
		ffo: "っふぉ",
		ffya: "っふゃ",
		ffyu: "っふゅ",
		ffyo: "っふょ",
		ffwa: "っふぁ",
		ffwi: "っふぃ",
		ffwu: "っふぅ",
		ffwe: "っふぇ",
		ffwo: "っふぉ",
		jja: "っじゃ",
		jji: "っじ",
		jju: "っじゅ",
		jje: "っじぇ",
		jjo: "っじょ",
		jjyi: "っじぃ",
		jjya: "っじゃ",
		jjyu: "っじゅ",
		jjye: "っじぇ",
		jjyo: "っじょ",
		cca: "っか",
		cci: "っち",
		ccu: "っく",
		cce: "っけ",
		cco: "っこ",
		ccha: "っちゃ",
		cchi: "っち",
		cchu: "っちゅ",
		cche: "っちぇ",
		ccho: "っちょ",
		ccya: "っちゃ",
		ccyi: "っちぃ",
		ccyu: "っちゅ",
		ccye: "っちぇ",
		ccyo: "っちょ",
		vvu: "っゔ",
		vva: "っゔぁ",
		vvi: "っゔぃ",
		vve: "っゔぇ",
		vvo: "っゔぉ",
		vvya: "っゔゃ",
		vvyu: "っゔゅ",
		vvyo: "っゔょ",
		xa: "ぁ",
		xi: "ぃ",
		xu: "ぅ",
		xe: "ぇ",
		xo: "ぉ",
		xya: "ゃ",
		xyu: "ゅ",
		xyo: "ょ",
		xtu: "っ",
		xtsu: "っ",
		xwa: "ゎ",
		la: "ぁ",
		li: "ぃ",
		lu: "ぅ",
		le: "ぇ",
		lo: "ぉ",
		lya: "ゃ",
		lyu: "ゅ",
		lyo: "ょ",
		ltu: "っ",
		ltsu: "っ",
		lwa: "ゎ"
	};
	/** Half-width → full-width character map (US keyboard)
	*  Port of DefaultKeymaps.h2zMapUS */
	const h2zMapUS = {
		"0": "０",
		"1": "１",
		"2": "２",
		"3": "３",
		"4": "４",
		"5": "５",
		"6": "６",
		"7": "７",
		"8": "８",
		"9": "９",
		",": "、",
		".": "。",
		"/": "・",
		"[": "「",
		"]": "」",
		"{": "『",
		"}": "』",
		"(": "（",
		")": "）",
		"<": "＜",
		">": "＞",
		"-": "ー",
		"~": "〜",
		"^": "＾",
		"_": "＿",
		"\"": "”",
		"'": "’",
		"`": "｀",
		"+": "＋",
		"=": "＝",
		"*": "＊",
		"!": "！",
		"?": "？",
		":": "：",
		";": "；",
		"@": "＠",
		"#": "＃",
		"$": "＄",
		"%": "％",
		"&": "＆",
		"|": "｜",
		"\\": "＼",
		"¥": "￥"
	};
	//#endregion
	//#region src/engine/keymap-expander.ts
	/** Expand a KeymapDefinition into an ExpandedKeymap with pre-computed lookup data */
	/** roles の宣言を正規名で引けるようにする（別名 leftThumb → holder1 を吸収） */
	function normalizedRoleDefs(def) {
		const out = {};
		for (const [name, role] of Object.entries(def.roles ?? {})) out[canonicalRole(name)] = role;
		return out;
	}
	function expandKeymap(def, opts = {}) {
		const roles = resolveRoles(def, opts.layout, opts.roleOverrides);
		for (const name of roles.unbound) opts.onDiagnostic?.({
			code: "role-unbound",
			message: `役 "${name}" に物理キーが割り当てられていません（この面は到達できません）`,
			where: "roles",
			key: name
		});
		const inputMappings = expandInputMappings(def.inputBase, def.suffixRules, def.inputMappings);
		const prefixSet = buildPrefixSet(inputMappings);
		const charMapBase = def.inputBase === "romaji" ? h2zMapUS : {};
		const characterMap = def.behavior.type === "sequential" ? {
			...charMapBase,
			...def.behavior.characterMap
		} : {};
		const chordData = def.behavior.type === "chord" ? expandChordData(def.behavior.config, opts, roles, normalizedRoleDefs(def)) : void 0;
		return {
			definition: def,
			requiredInputLevel: requiredInputLevel(def),
			roleBindings: roles.bindings,
			unboundRoles: roles.unbound,
			inputMappings,
			prefixSet,
			characterMap,
			modeKeys: def.modeKeys ?? [],
			keyRemap: def.keyRemap ?? {},
			chordData
		};
	}
	/** Expand input mappings: base + suffix rules + explicit mappings
	*  Port of KeymapDefinition.expandInputMappings */
	function expandInputMappings(inputBase, suffixRules, explicitMappings) {
		let base = {};
		if (inputBase === "romaji") base = { ...standardRomajiTable };
		const allEntries = { ...base };
		if (explicitMappings) {
			for (const [k, v] of Object.entries(explicitMappings)) if (!k.startsWith("_comment")) allEntries[k] = v;
		}
		const vowels = /* @__PURE__ */ new Set([
			"a",
			"i",
			"u",
			"e",
			"o"
		]);
		const suffixExpansions = {};
		if (suffixRules && Object.keys(suffixRules).length > 0) for (const [romajiSeq, kanaOutput] of Object.entries(allEntries)) {
			const lastChar = romajiSeq[romajiSeq.length - 1];
			if (!lastChar || !vowels.has(lastChar)) continue;
			const consonantPrefix = romajiSeq.slice(0, -1);
			if (consonantPrefix.length === 0) continue;
			for (const [suffixKey, rule] of Object.entries(suffixRules)) {
				if (lastChar !== rule.vowel) continue;
				const expandedKey = consonantPrefix + suffixKey;
				suffixExpansions[expandedKey] = kanaOutput + rule.suffix;
			}
		}
		const result = { ...base };
		for (const [k, v] of Object.entries(suffixExpansions)) result[k] = v;
		if (explicitMappings) {
			for (const [k, v] of Object.entries(explicitMappings)) if (!k.startsWith("_comment")) result[k] = v;
		}
		return result;
	}
	/** Build a set of all prefixes of mapping keys (for greedy longest-match) */
	function buildPrefixSet(mappings) {
		const prefixes = /* @__PURE__ */ new Set();
		for (const key of Object.keys(mappings)) for (let i = 1; i < key.length; i++) prefixes.add(key.slice(0, i));
		return prefixes;
	}
	/** Create an ExpandedKeymap for the built-in romaji (US) layout */
	function createBuiltinRomajiUS() {
		return expandKeymap({
			formatVersion: "1.0",
			name: "ローマ字(QWERTY US)",
			description: "標準ローマ字入力（US キーボード）",
			keyboardLayout: "us",
			targetScript: "hiragana",
			behavior: {
				type: "sequential",
				characterMap: h2zMapUS
			},
			inputBase: "romaji",
			modeKeys: [{
				trigger: {
					keyCode: 44,
					modifiers: 2
				},
				action: { type: "toggleInputMode" }
			}]
		});
	}
	/** Create an ExpandedKeymap for the built-in romaji (JIS) layout */
	function createBuiltinRomajiJIS() {
		return expandKeymap({
			formatVersion: "1.0",
			name: "ローマ字(QWERTY JIS)",
			description: "標準ローマ字入力（JIS キーボード）",
			keyboardLayout: "jis",
			targetScript: "hiragana",
			behavior: {
				type: "sequential",
				characterMap: h2zMapUS
			},
			inputBase: "romaji",
			modeKeys: [
				{
					trigger: {
						keyCode: 145,
						modifiers: 0
					},
					action: { type: "switchToEnglish" }
				},
				{
					trigger: {
						keyCode: 144,
						modifiers: 0
					},
					action: { type: "switchToJapanese" }
				},
				{
					trigger: {
						keyCode: 44,
						modifiers: 2
					},
					action: { type: "toggleInputMode" }
				}
			]
		});
	}
	/** ChordKey name → bit index (matches Swift enum rawValue) */
	const CHORD_KEY_BIT_INDEX = {
		Q: 0,
		W: 1,
		E: 2,
		R: 3,
		T: 4,
		Y: 5,
		U: 6,
		I: 7,
		O: 8,
		P: 9,
		A: 10,
		S: 11,
		D: 12,
		F: 13,
		G: 14,
		H: 15,
		J: 16,
		K: 17,
		L: 18,
		semicolon: 19,
		Z: 20,
		X: 21,
		C: 22,
		V: 23,
		B: 24,
		N: 25,
		M: 26,
		comma: 27,
		dot: 28,
		slash: 29,
		space: 30,
		leftThumb: 31,
		rightThumb: 32
	};
	/** Parse a lookup key like "leftThumb+W" → combined bitmask */
	function parseLookupKey(key, keyBits) {
		const parts = key.split("+");
		let bits = 0;
		for (const part of parts) {
			const b = keyBits.get(part);
			if (b === void 0) return void 0;
			bits += b;
		}
		return bits;
	}
	/** Expand chord config into ExpandedChordData */
	function expandChordData(config, opts = {}, roles, roleDefs) {
		const diag = opts.onDiagnostic;
		const roleBitIndex = /* @__PURE__ */ new Map();
		(roles?.order ?? []).forEach((name, i) => roleBitIndex.set(name, 30 + i));
		/** ビットマスク表記のキーを解く。未知の ChordKey 名は報告して捨てる */
		const parseKeyOrReport = (keyStr, where, value) => {
			const bits = parseLookupKey(keyStr, keyBits);
			if (bits === void 0) diag?.({
				code: "chord-key-unknown",
				message: `未知の ChordKey 名を含む組合せです: "${keyStr}"`,
				where,
				key: keyStr,
				value
			});
			return bits;
		};
		const keyBits = /* @__PURE__ */ new Map();
		for (const [name, idx] of Object.entries(CHORD_KEY_BIT_INDEX)) keyBits.set(name, 2 ** idx);
		for (const [name, idx] of roleBitIndex) keyBits.set(name, 2 ** idx);
		for (const alias of [
			"leftThumb",
			"rightThumb",
			"space"
		]) {
			const canon = canonicalRole(alias);
			const idx = roleBitIndex.get(canon);
			if (idx !== void 0 && !roleBitIndex.has(alias)) keyBits.set(alias, 2 ** idx);
		}
		const hidToChordKey = /* @__PURE__ */ new Map();
		for (const [roleName, physKeys] of roles?.bindings ?? []) for (const physName of physKeys) {
			const hid = hidNameToCode(physName);
			if (hid !== void 0) hidToChordKey.set(hid, roleName);
			else diag?.({
				code: "hid-key-unknown",
				message: `役 "${roleName}" に未知の物理キー名が割り当てられています: "${physName}"`,
				where: "roles",
				key: physName,
				value: roleName
			});
		}
		for (const [hidName, chordKeyName] of Object.entries(config.hidToKey)) {
			if (hidName.startsWith("_comment")) continue;
			const hid = hidNameToCode(hidName);
			if (hid !== void 0) hidToChordKey.set(hid, chordKeyName);
			else diag?.({
				code: "hid-key-unknown",
				message: `未知の物理キー名です: "${hidName}"`,
				where: "behavior.config.hidToKey",
				key: hidName,
				value: chordKeyName
			});
		}
		const lookupTable = /* @__PURE__ */ new Map();
		for (const [keyStr, output] of Object.entries(config.lookupTable)) {
			if (keyStr.startsWith("_comment")) continue;
			const bits = parseKeyOrReport(keyStr, "behavior.config.lookupTable", output);
			if (bits !== void 0) lookupTable.set(bits, output);
		}
		const specialActions = /* @__PURE__ */ new Map();
		const specialActionGuards = /* @__PURE__ */ new Map();
		for (const [keyStr, rawAction] of Object.entries(config.specialActions)) {
			if (keyStr.startsWith("_comment")) continue;
			const where = "behavior.config.specialActions";
			const label = typeof rawAction === "string" ? rawAction : JSON.stringify(rawAction);
			const bits = parseKeyOrReport(keyStr, where, label);
			const parsed = parseKeyActionResult(rawAction, "keymap.specialActions");
			if (!parsed.ok) {
				reportActionRejection(diag, parsed.reason, where, keyStr, label);
				continue;
			}
			if (bits !== void 0) {
				specialActions.set(bits, parsed.action);
				if (parsed.when) specialActionGuards.set(bits, parsed.when);
			}
		}
		const shiftKeys = new Set(roles?.order ?? []);
		const shiftSingleTapActions = /* @__PURE__ */ new Map();
		const shiftSingleTapGuards = /* @__PURE__ */ new Map();
		const spaceRole = hidToChordKey.get(HID.SPACE);
		for (const [roleName, physKeys] of roles?.bindings ?? []) {
			const decl = roleDefs?.[roleName]?.singleTapAction;
			if (decl !== void 0) {
				const parsed = parseKeyActionResult(decl, "keymap.singleTapAction");
				if (parsed.ok) {
					shiftSingleTapActions.set(roleName, parsed.action);
					if (parsed.when) shiftSingleTapGuards.set(roleName, parsed.when);
				} else reportActionRejection(diag, parsed.reason, "roles", roleName, String(decl));
			} else if (physKeys.includes("space")) shiftSingleTapActions.set(roleName, { type: "convert" });
		}
		for (const sk of config.shiftKeys ?? []) {
			shiftKeys.add(sk.key);
			if (sk.singleTapAction) {
				const parsed = parseKeyActionResult(sk.singleTapAction, "keymap.singleTapAction");
				if (parsed.ok) {
					shiftSingleTapActions.set(sk.key, parsed.action);
					if (parsed.when) shiftSingleTapGuards.set(sk.key, parsed.when);
				} else reportActionRejection(diag, parsed.reason, "behavior.config.shiftKeys", sk.key, sk.singleTapAction);
			} else if (sk.key === spaceRole) shiftSingleTapActions.set(sk.key, { type: "convert" });
		}
		let englishLookupTable = null;
		if (config.englishLookupTable) {
			englishLookupTable = /* @__PURE__ */ new Map();
			for (const [keyStr, output] of Object.entries(config.englishLookupTable)) {
				if (keyStr.startsWith("_comment")) continue;
				const bits = parseKeyOrReport(keyStr, "behavior.config.englishLookupTable", output);
				if (bits !== void 0) englishLookupTable.set(bits, output);
			}
		}
		let englishSpecialActions = null;
		let englishSpecialActionGuards = null;
		if (config.englishSpecialActions) {
			englishSpecialActions = /* @__PURE__ */ new Map();
			englishSpecialActionGuards = /* @__PURE__ */ new Map();
			for (const [keyStr, rawAction] of Object.entries(config.englishSpecialActions)) {
				if (keyStr.startsWith("_comment")) continue;
				const where = "behavior.config.englishSpecialActions";
				const label = typeof rawAction === "string" ? rawAction : JSON.stringify(rawAction);
				const bits = parseKeyOrReport(keyStr, where, label);
				const parsed = parseKeyActionResult(rawAction, "keymap.englishSpecialActions");
				if (!parsed.ok) {
					reportActionRejection(diag, parsed.reason, where, keyStr, label);
					continue;
				}
				if (bits !== void 0) {
					englishSpecialActions.set(bits, parsed.action);
					if (parsed.when) englishSpecialActionGuards.set(bits, parsed.when);
				}
			}
		}
		return {
			hidToChordKey,
			lookupTable,
			specialActions,
			specialActionGuards,
			shiftKeys,
			shiftSingleTapActions,
			shiftSingleTapGuards,
			keyBits,
			judgment: config.judgment ?? "window",
			simultaneousWindow: Math.round(config.simultaneousWindow * 1e3),
			englishLookupTable,
			englishSpecialActions,
			englishSpecialActionGuards
		};
	}
	//#endregion
	//#region src/engine/version.ts
	const ENGINE_VERSION = "2.0.0";
	//#endregion
	//#region src/engine/key-router.ts
	/** Route a KeyEvent to a KeyAction based on the expanded keymap */
	function routeKey(event, keymap, isComposing, state, isDirectEnglishMode, phase = isComposing ? "composing" : "idle") {
		const modeAction = matchModeKey(event, keymap, phase);
		if (modeAction) return modeAction;
		if (event.keyCode === HID.BACKSPACE && !(event.modifiers & (KeyModifierFlags.META | KeyModifierFlags.ALT))) return { type: "deleteBack" };
		if (isComposing && event.modifiers & KeyModifierFlags.CONTROL) return routeControlKey(event);
		if (isComposing) {
			const ctrlAction = routeStandardControlKey(event, state, keymap.chordData ? isChordShiftKeyCode(event.keyCode, keymap.chordData) : false);
			if (ctrlAction) return ctrlAction;
		}
		if (keymap.chordData) {
			const spaceIsChordKey = keymap.chordData.hidToChordKey.has(HID.SPACE);
			if (!(event.keyCode === HID.SPACE && !spaceIsChordKey)) return routeChord(event, keymap.chordData, isDirectEnglishMode);
		}
		if (!isComposing && !isDirectEnglishMode && event.keyCode === HID.SPACE) return {
			type: "insertSpace",
			shifted: !!(event.modifiers & KeyModifierFlags.SHIFT)
		};
		return routeSequential(event, keymap, isComposing, isDirectEnglishMode);
	}
	/** Match modeKeys triggers */
	function matchModeKey(event, keymap, phase) {
		const eventMods = event.modifiers & (KeyModifierFlags.SHIFT | KeyModifierFlags.CONTROL | KeyModifierFlags.ALT);
		for (const withModifiers of [true, false]) for (const entry of keymap.modeKeys) {
			const t = entry.trigger;
			if (t.keyCode !== event.keyCode) continue;
			if (t.modifiers !== 0 !== withModifiers) continue;
			if (!isActiveIn(entry.when, phase)) continue;
			if (t.modifiers === 0 || t.modifiers === eventMods) return entry.action;
		}
		return null;
	}
	/** Ctrl+key → simplified Emacs bindings */
	function routeControlKey(event) {
		switch (event.keyCode) {
			case HID.H: return { type: "deleteBack" };
			case HID.M: return { type: "confirm" };
			case HID.G: return { type: "cancel" };
			case HID.J: return { type: "confirm" };
			default: return { type: "pass" };
		}
	}
	/** Standard control keys during composing */
	function routeStandardControlKey(event, _state, isChordShiftKey = false) {
		if (isChordShiftKey) return null;
		switch (event.keyCode) {
			case HID.ENTER:
			case HID.TAB: return { type: "confirm" };
			case HID.ESCAPE: return { type: "cancel" };
			case HID.SPACE: return { type: "convert" };
			case HID.BACKSPACE: return { type: "deleteBack" };
			default: return null;
		}
	}
	/** Sequential input routing */
	function routeSequential(event, keymap, isComposing, isDirectEnglishMode) {
		if (isDirectEnglishMode) {
			const chars = event.characters;
			if (chars.length === 1 && isPrintable(chars)) return {
				type: "directInsert",
				text: chars
			};
			return { type: "pass" };
		}
		const chars = (keymap.definition.base === "positional" && event.modifiers === 0 ? hidToUsLegend(event.keyCode) : void 0) ?? event.characters;
		if (chars.length !== 1) return { type: "pass" };
		const c = chars;
		const logical = keymap.keyRemap[c] ?? c;
		if (keymap.characterMap[logical] || isLetter(logical) || isComposing && isDigit(logical)) return {
			type: "printable",
			char: c
		};
		if (Object.keys(keymap.inputMappings).length > 0 && isPrintable(c) && c !== " ") return {
			type: "printable",
			char: c
		};
		return { type: "pass" };
	}
	function isPrintable(c) {
		if (c.length !== 1) return false;
		const code = c.charCodeAt(0);
		return code >= 32 && code !== 127;
	}
	function isLetter(c) {
		if (c.length !== 1) return false;
		return /^[a-zA-Z]$/.test(c);
	}
	function isDigit(c) {
		if (c.length !== 1) return false;
		return /^[0-9]$/.test(c);
	}
	/** Check if a HID key code maps to a chord shift key */
	function isChordShiftKeyCode(keyCode, chord) {
		const chordKey = chord.hidToChordKey.get(keyCode);
		if (!chordKey) return false;
		return chord.shiftKeys.has(chordKey);
	}
	/** Route a key event for chord behavior */
	function routeChord(event, chord, isDirectEnglishMode) {
		if (isDirectEnglishMode) {
			const noModifiers = (event.modifiers & (KeyModifierFlags.SHIFT | KeyModifierFlags.CONTROL | KeyModifierFlags.ALT | KeyModifierFlags.META)) === 0;
			if (chord.englishLookupTable !== null && noModifiers) {
				const chordKey = chord.hidToChordKey.get(event.keyCode);
				if (chordKey) {
					if (chord.shiftKeys.has(chordKey)) return {
						type: "chordShiftDown",
						key: chordKey
					};
					return {
						type: "chordInput",
						key: chordKey
					};
				}
			}
			const chars = event.characters;
			if (chars.length === 1 && isPrintable(chars)) return {
				type: "directInsert",
				text: chars
			};
			return { type: "pass" };
		}
		const chordKey = chord.hidToChordKey.get(event.keyCode);
		if (!chordKey) return { type: "pass" };
		if (chord.shiftKeys.has(chordKey)) return {
			type: "chordShiftDown",
			key: chordKey
		};
		return {
			type: "chordInput",
			key: chordKey
		};
	}
	//#endregion
	//#region src/engine/sequential-buffer.ts
	/** Sequential input buffer with greedy longest-match resolution */
	var SequentialBuffer = class {
		constructor() {
			this.buffer = "";
			this.mappings = {};
			this.prefixSet = /* @__PURE__ */ new Set();
			this.resolvedKana = "";
		}
		/** Update the mapping tables (call when keymap changes) */
		setMappings(mappings, prefixSet) {
			this.mappings = mappings;
			this.prefixSet = prefixSet;
			this.buffer = "";
			this.resolvedKana = "";
		}
		/** Add a character to the buffer and drain resolved kana.
		*  Returns the newly resolved kana (may be empty if waiting for more input). */
		input(char) {
			this.buffer += char;
			return this.drain();
		}
		/** Force-flush the buffer (before confirm/cancel).
		*  Returns any remaining kana. */
		flush() {
			if (this.buffer.length === 0) return "";
			const exact = this.mappings[this.buffer];
			if (exact !== void 0) {
				this.buffer = "";
				return exact;
			}
			return this.drain(true);
		}
		/** Delete the last character from the buffer.
		*  Returns true if a buffer character was deleted, false if buffer was empty. */
		deleteBack() {
			if (this.buffer.length > 0) {
				this.buffer = this.buffer.slice(0, -1);
				return true;
			}
			return false;
		}
		/** BS の pending 復帰用: 未解決文字列をバッファ先頭へ戻す（repend が使う） */
		restore(text) {
			this.buffer = text + this.buffer;
		}
		/** Get current pending buffer text (for display) */
		get pending() {
			return this.buffer;
		}
		/** Get pending buffer resolved as kana for display (pendingBufferText port) */
		get pendingDisplay() {
			if (this.buffer.length === 0) return "";
			const exact = this.mappings[this.buffer];
			if (exact !== void 0) return exact;
			let result = "";
			let remaining = this.buffer;
			while (remaining.length > 0) {
				let matched = false;
				for (let len = remaining.length; len >= 1; len--) {
					const prefix = remaining.slice(0, len);
					const kana = this.mappings[prefix];
					if (kana !== void 0) {
						result += kana;
						remaining = remaining.slice(len);
						matched = true;
						break;
					}
				}
				if (!matched) {
					result += remaining[0];
					remaining = remaining.slice(1);
				}
			}
			return result;
		}
		/** Whether the buffer is empty */
		get isEmpty() {
			return this.buffer.length === 0;
		}
		/** Reset buffer state */
		reset() {
			this.buffer = "";
			this.resolvedKana = "";
		}
		/** Drain the buffer using greedy longest-match + backtracking.
		*  Port of drainSequentialBuffer (InputManager.swift L477-515) */
		drain(force = false) {
			let output = "";
			while (this.buffer.length > 0) {
				const hasMatch = this.mappings[this.buffer] !== void 0;
				const isPrefix = this.prefixSet.has(this.buffer);
				if (hasMatch && (!isPrefix || force)) {
					output += this.mappings[this.buffer];
					this.buffer = "";
				} else if (isPrefix && !force) return output;
				else {
					let resolved = false;
					for (let len = this.buffer.length - 1; len >= 1; len--) {
						const prefix = this.buffer.slice(0, len);
						if (this.mappings[prefix] !== void 0) {
							output += this.mappings[prefix];
							this.buffer = this.buffer.slice(len);
							resolved = true;
							break;
						}
					}
					if (!resolved) {
						output += this.buffer[0];
						this.buffer = this.buffer.slice(1);
					}
				}
			}
			return output;
		}
	};
	//#endregion
	//#region src/engine/simultaneous-buffer.ts
	/**
	* Simultaneous key buffer — eager output + rollback.
	*
	* 1st key → output single-hit immediately (0ms delay)
	* 2nd key within window → rollback and replace with chord result
	* 3rd key within window → try triple chord, else confirm and start fresh
	* Shift key → no eager output, wait for timer
	*/
	var SimultaneousKeyBuffer = class SimultaneousKeyBuffer {
		static {
			this.EMPTY_LOOKUP = /* @__PURE__ */ new Map();
		}
		static {
			this.EMPTY_SPECIALS = /* @__PURE__ */ new Map();
		}
		static {
			this.EMPTY_GUARDS = /* @__PURE__ */ new Map();
		}
		/** 現在のモードの lookup テーブル */
		lookup() {
			return this.englishMode ? this.chord.englishLookupTable ?? SimultaneousKeyBuffer.EMPTY_LOOKUP : this.chord.lookupTable;
		}
		/** 現在のモードの specialActions テーブル */
		specials() {
			return this.englishMode ? this.chord.englishSpecialActions ?? SimultaneousKeyBuffer.EMPTY_SPECIALS : this.chord.specialActions;
		}
		guards() {
			return this.englishMode ? this.chord.englishSpecialActionGuards ?? SimultaneousKeyBuffer.EMPTY_GUARDS : this.chord.specialActionGuards;
		}
		/**
		* その組合せの specialAction。**局面ガードが外れていれば「定義が無い」ものとして扱う**
		* （lookupTable にあればそちらが出て、無ければ fall-through する）。
		*/
		specialAt(bits) {
			const action = this.specials().get(bits);
			if (action === void 0) return void 0;
			const when = this.guards().get(bits);
			if (when && this.hostPhase && !isActiveIn(when, this.hostPhase())) return void 0;
			return action;
		}
		hasSpecialAt(bits) {
			return this.specialAt(bits) !== void 0;
		}
		/** シフト役の単打アクション。局面ガードが外れていれば無し扱い */
		singleTapAt(key) {
			const action = this.chord.shiftSingleTapActions.get(key);
			if (action === void 0) return void 0;
			const when = this.chord.shiftSingleTapGuards.get(key);
			if (when && this.hostPhase && !isActiveIn(when, this.hostPhase())) return void 0;
			return action;
		}
		constructor(chord) {
			this.state = { type: "idle" };
			this.timerId = null;
			this.pressedKeys = /* @__PURE__ */ new Set();
			this.windowOverride = null;
			this.englishMode = false;
			this.hostPhase = null;
			this.onOutput = null;
			this.onShiftSingle = null;
			this.onSpecialAction = null;
			this.mutualOrder = [];
			this.mutualGroup = /* @__PURE__ */ new Set();
			this.mutualCharCount = 0;
			this.mutualPending = null;
			this.mutualOutputted = false;
			this.chord = chord;
		}
		/** Process key down */
		keyDown(key) {
			if (this.chord.judgment === "mutual") {
				this.mutualKeyDown(key);
				return;
			}
			this.pressedKeys.add(key);
			switch (this.state.type) {
				case "idle":
					this.handleFirstKey(key);
					break;
				case "waiting":
					this.handleSecondKey(key, this.state.firstKey, this.state.firstOutput, this.state.firstCharCount);
					break;
				case "waitingThird":
					this.handleThirdKey(key, this.state.bufferedKeys, this.state.bits, this.state.charCount, this.state.pendingAction);
					break;
				case "shiftHeld":
					this.handleShiftHeldKey(key, this.state.shiftKey, this.state.used);
					break;
			}
		}
		/** Process key up */
		keyUp(key) {
			if (this.chord.judgment === "mutual") {
				this.mutualKeyUp(key);
				return;
			}
			this.pressedKeys.delete(key);
			if (this.state.type === "shiftHeld" && this.state.shiftKey === key) {
				if (!this.state.used) {
					const action = this.singleTapAt(key);
					if (action) this.onShiftSingle?.(action);
				}
				this.state = { type: "idle" };
			}
		}
		/** Reset buffer */
		reset() {
			this.cancelTimer();
			this.state = { type: "idle" };
			this.clearMutualGroup();
		}
		/**
		* 相互シフト方式の keyDown。
		* 「押下中キー集合 + 新キー」の組合せがテーブルにあるかだけで chord / fall-through を判定する。
		*/
		mutualKeyDown(key) {
			if (this.pressedKeys.has(key)) return;
			this.pressedKeys.add(key);
			const bit = this.getBit(key);
			if (bit === void 0) return;
			if (this.mutualGroup.has(key)) {
				this.resolveMutualGroup();
				this.startMutualGroup(key);
				return;
			}
			if (this.mutualGroup.size === 0) {
				this.startMutualGroup(key);
				return;
			}
			let candidate = bit;
			for (const k of this.mutualGroup) candidate += this.getBit(k) ?? 0;
			if (this.lookup().has(candidate) || this.hasSpecialAt(candidate)) {
				this.mutualGroup.add(key);
				this.mutualOrder.push(key);
				this.evaluateMutualChord(candidate);
			} else {
				this.resolveMutualGroup();
				this.startMutualGroup(key);
			}
		}
		/** 相互シフト方式の keyUp */
		mutualKeyUp(key) {
			this.pressedKeys.delete(key);
			if (this.pressedKeys.size === 0) {
				this.finalizeMutual();
				return;
			}
			if (this.mutualGroup.has(key) && (this.mutualOutputted || this.mutualPending !== null)) {
				const pending = this.mutualPending;
				if (pending !== null) {
					this.mutualPending = null;
					this.mutualOutputted = true;
				}
				this.mutualGroup.delete(key);
				const idx = this.mutualOrder.indexOf(key);
				if (idx >= 0) this.mutualOrder.splice(idx, 1);
				this.mutualCharCount = 0;
				if (pending !== null) this.onSpecialAction?.(pending);
			}
		}
		/** グループを chord 評価する（lookup 優先、なければ specialAction を保留） */
		evaluateMutualChord(bits) {
			const text = this.lookup().get(bits);
			if (text !== void 0) {
				this.onOutput?.(text, this.mutualCharCount);
				this.mutualCharCount = text.length;
				this.mutualPending = null;
				this.mutualOutputted = true;
				return;
			}
			const action = this.specialAt(bits);
			if (action) {
				if (this.mutualCharCount > 0) {
					this.onOutput?.("", this.mutualCharCount);
					this.mutualCharCount = 0;
				}
				this.mutualPending = action;
				this.mutualOutputted = false;
			}
		}
		/**
		* 現グループを解決する（fall-through / グループ在籍キー再打鍵時）。
		* chord 出力済みなら何もしない。specialAction 保留中なら発火。
		* 未出力なら押下順に単打出力する。解決後グループは空（disarm）。
		*/
		resolveMutualGroup() {
			if (this.mutualPending !== null) this.onSpecialAction?.(this.mutualPending);
			else if (!this.mutualOutputted) for (const k of this.mutualOrder) this.mutualSingleTap(k);
			this.clearMutualGroup();
		}
		/** 全キーリリース時の確定。単打はここで出力される（chord は keyDown 時に出力済み） */
		finalizeMutual() {
			if (this.mutualGroup.size === 1) {
				if (!this.mutualOutputted) {
					const only = this.mutualOrder[0];
					if (only !== void 0) this.mutualSingleTap(only);
				}
			} else if (this.mutualGroup.size >= 2) {
				if (this.mutualPending !== null) this.onSpecialAction?.(this.mutualPending);
				else if (!this.mutualOutputted) for (const k of this.mutualOrder) this.mutualSingleTap(k);
			}
			this.clearMutualGroup();
		}
		/** 単打出力（シフトキー → 単打アクション、specialAction 優先、なければ文字） */
		mutualSingleTap(key) {
			if (this.chord.shiftKeys.has(key)) {
				const action = this.singleTapAt(key);
				if (action) this.onShiftSingle?.(action);
				return;
			}
			const bit = this.getBit(key);
			if (bit === void 0) return;
			const action = this.specialAt(bit);
			if (action) {
				this.onSpecialAction?.(action);
				return;
			}
			const text = this.lookup().get(bit);
			if (text !== void 0) this.onOutput?.(text, 0);
		}
		startMutualGroup(key) {
			this.mutualGroup = /* @__PURE__ */ new Set([key]);
			this.mutualOrder = [key];
		}
		clearMutualGroup() {
			this.mutualGroup.clear();
			this.mutualOrder = [];
			this.mutualCharCount = 0;
			this.mutualPending = null;
			this.mutualOutputted = false;
		}
		handleFirstKey(key) {
			const bits = this.getBit(key);
			if (!bits) return;
			if (this.chord.shiftKeys.has(key)) {
				this.state = {
					type: "waiting",
					firstKey: key,
					firstOutput: null,
					firstCharCount: 0
				};
				this.startTimer();
			} else {
				const singleChar = this.lookup().get(bits);
				if (singleChar) {
					this.onOutput?.(singleChar, 0);
					this.state = {
						type: "waiting",
						firstKey: key,
						firstOutput: singleChar,
						firstCharCount: singleChar.length
					};
					this.startTimer();
				} else {
					this.state = {
						type: "waiting",
						firstKey: key,
						firstOutput: null,
						firstCharCount: 0
					};
					this.startTimer();
				}
			}
		}
		handleSecondKey(key, firstKey, firstOutput, firstCharCount) {
			this.cancelTimer();
			if (key === firstKey) {
				this.state = { type: "idle" };
				this.handleFirstKey(key);
				return;
			}
			const firstBit = this.getBit(firstKey);
			const keyBit = this.getBit(key);
			if (!firstBit || !keyBit) return;
			const combined = firstBit + keyBit;
			const specialAction = this.specialAt(combined);
			if (specialAction) {
				if (firstCharCount > 0) this.onOutput?.("", firstCharCount);
				const keys = /* @__PURE__ */ new Set([firstKey, key]);
				this.state = {
					type: "waitingThird",
					bufferedKeys: keys,
					bits: combined,
					charCount: 0,
					pendingAction: specialAction
				};
				this.startTimer();
				return;
			}
			const simultaneousResult = this.lookup().get(combined);
			if (simultaneousResult) {
				if (firstCharCount > 0) this.onOutput?.(simultaneousResult, firstCharCount);
				else this.onOutput?.(simultaneousResult, 0);
				const keys = /* @__PURE__ */ new Set([firstKey, key]);
				this.state = {
					type: "waitingThird",
					bufferedKeys: keys,
					bits: combined,
					charCount: simultaneousResult.length,
					pendingAction: null
				};
				this.startTimer();
			} else if (firstOutput === null) {
				if (this.chord.shiftKeys.has(firstKey)) {
					const action = this.singleTapAt(firstKey);
					if (action) this.onShiftSingle?.(action);
				} else {
					const firstBits = this.getBit(firstKey);
					const pendingAction2 = firstBits ? this.specialAt(firstBits) : null;
					if (pendingAction2) this.onSpecialAction?.(pendingAction2);
				}
				this.state = { type: "idle" };
				this.handleFirstKey(key);
			} else {
				const keys = /* @__PURE__ */ new Set([firstKey, key]);
				const singleChar = this.lookup().get(keyBit);
				if (singleChar) {
					this.onOutput?.(singleChar, 0);
					this.state = {
						type: "waitingThird",
						bufferedKeys: keys,
						bits: combined,
						charCount: firstCharCount + singleChar.length,
						pendingAction: null
					};
				} else this.state = {
					type: "waitingThird",
					bufferedKeys: keys,
					bits: combined,
					charCount: firstCharCount,
					pendingAction: null
				};
				this.startTimer();
			}
		}
		handleThirdKey(key, bufferedKeys, existingBits, charCount, pendingAction) {
			this.cancelTimer();
			if (bufferedKeys.has(key)) {
				if (pendingAction) this.onSpecialAction?.(pendingAction);
				this.state = { type: "idle" };
				this.handleFirstKey(key);
				return;
			}
			const keyBit = this.getBit(key);
			if (!keyBit) return;
			const tripleKeys = existingBits + keyBit;
			const tripleResult = this.lookup().get(tripleKeys);
			if (tripleResult) {
				this.onOutput?.(tripleResult, charCount);
				this.state = { type: "idle" };
			} else {
				if (pendingAction) this.onSpecialAction?.(pendingAction);
				this.state = { type: "idle" };
				this.handleFirstKey(key);
			}
		}
		handleShiftHeldKey(key, shiftKey, used) {
			if (key === shiftKey) return;
			const shiftBit = this.getBit(shiftKey);
			const keyBit = this.getBit(key);
			if (!shiftBit || !keyBit) return;
			const combined = shiftBit + keyBit;
			const specialAction = this.specialAt(combined);
			if (specialAction) {
				this.onSpecialAction?.(specialAction);
				this.state = {
					type: "shiftHeld",
					shiftKey,
					used: true
				};
				return;
			}
			const shifted = this.lookup().get(combined);
			if (shifted) {
				this.onOutput?.(shifted, 0);
				this.state = {
					type: "shiftHeld",
					shiftKey,
					used: true
				};
				return;
			}
			if (!used) {
				const action = this.singleTapAt(shiftKey);
				if (action) this.onShiftSingle?.(action);
			}
			this.state = { type: "idle" };
			this.handleFirstKey(key);
		}
		startTimer() {
			this.cancelTimer();
			this.timerId = setTimeout(() => {
				this.timerId = null;
				this.onTimerExpired();
			}, this.windowOverride ?? this.chord.simultaneousWindow);
		}
		cancelTimer() {
			if (this.timerId !== null) {
				clearTimeout(this.timerId);
				this.timerId = null;
			}
		}
		onTimerExpired() {
			switch (this.state.type) {
				case "waiting": {
					const { firstKey } = this.state;
					if (this.chord.shiftKeys.has(firstKey)) if (this.pressedKeys.has(firstKey)) this.state = {
						type: "shiftHeld",
						shiftKey: firstKey,
						used: false
					};
					else {
						const action = this.singleTapAt(firstKey);
						if (action) this.onShiftSingle?.(action);
						this.state = { type: "idle" };
					}
					else {
						const bits = this.getBit(firstKey);
						if (bits) {
							const pendingAction = this.specialAt(bits);
							if (pendingAction) this.onSpecialAction?.(pendingAction);
						}
						this.state = { type: "idle" };
					}
					break;
				}
				case "waitingThird": {
					const { pendingAction } = this.state;
					if (pendingAction) this.onSpecialAction?.(pendingAction);
					const heldShift = this.findHeldShiftKey();
					if (heldShift) this.state = {
						type: "shiftHeld",
						shiftKey: heldShift,
						used: true
					};
					else this.state = { type: "idle" };
					break;
				}
			}
		}
		getBit(key) {
			return this.chord.keyBits.get(key);
		}
		/** Find a shift key that is still physically pressed */
		findHeldShiftKey() {
			for (const key of this.pressedKeys) if (this.chord.shiftKeys.has(key)) return key;
			return null;
		}
	};
	//#endregion
	//#region src/engine/input-engine.ts
	var InputEngine = class {
		constructor(keymap) {
			this.confirmedText = "";
			this.composingKana = "";
			this.inputMode = "japanese";
			this.buffer = new SequentialBuffer();
			this.chordBuffer = null;
			this.onStateChange = null;
			this.onHostAction = null;
			this.hostPhase = null;
			this.keymap = keymap;
			this.buffer.setMappings(keymap.inputMappings, keymap.prefixSet);
			this.setupChordBuffer(keymap);
		}
		/** Switch to a different keymap */
		setKeymap(keymap) {
			this.confirmComposition();
			this.keymap = keymap;
			this.buffer.setMappings(keymap.inputMappings, keymap.prefixSet);
			this.chordBuffer?.reset();
			this.setupChordBuffer(keymap);
		}
		/** Process a key event and return the updated state */
		processKey(event) {
			const isComposing = this.composingKana.length > 0 || !this.buffer.isEmpty;
			const state = isComposing ? "composing" : "idle";
			const isEnglish = this.inputMode === "english";
			const action = routeKey(event, this.keymap, isComposing, state, isEnglish, this.phase);
			this.executeAction(action);
			return this.getState();
		}
		/** Process a key up event (for chord buffer) */
		processKeyUp(event) {
			if (this.chordBuffer && this.keymap.chordData) {
				const chordKey = this.keymap.chordData.hidToChordKey.get(event.keyCode);
				if (chordKey) this.chordBuffer.keyUp(chordKey);
			}
			return this.getState();
		}
		/** Get current state */
		/**
		* このエンジン自身が合成中か（よみ or ローマ字バッファを保持している）。
		*
		* `getState()` は `phase` を含み、`phase` は `hostPhase()` を呼ぶ。セッション側が
		* `hostPhase` の中で `getState()` を見ると**無限再帰**になるので、問い合わせ用に
		* 副作用の無いこちらを公開している。
		*/
		get isComposing() {
			return this.composingKana.length > 0 || !this.buffer.isEmpty;
		}
		/**
		* 現在の局面。所有者（セッション層）が居ればそちらを正とし、居なければ自分の
		* 合成状態から導出する。
		*/
		get phase() {
			if (this.hostPhase) return this.hostPhase();
			return this.isComposing ? "composing" : "idle";
		}
		getState() {
			const isComposing = this.composingKana.length > 0 || !this.buffer.isEmpty;
			return {
				phase: this.phase,
				confirmedText: this.confirmedText,
				composingKana: this.composingKana,
				pendingBuffer: this.buffer.pending,
				pendingDisplay: this.buffer.pendingDisplay,
				inputMode: this.inputMode,
				isComposing
			};
		}
		/**
		* 確定済みテキストを取り出して内部バッファをクリアする（差分取り出し用）。
		*
		* `getState().confirmedText` は確定かなを accumulate し続けるため、確定分を
		* 外部バッファ（例: QuuBee → Mozc）へ流し込むホストは、状態変化のたびに本メソッドで
		* 確定分だけを引き取ってエンジン側を空にできる。composing / inputMode には影響しない。
		*
		* 注意: 取り出し後は confirmedText が空になるため、composing が空の状態での
		* `deleteBack` はエンジン内で消す対象を持たない（確定済みテキストの所有権はホスト側へ移る）。
		*/
		takeConfirmedText() {
			const text = this.confirmedText;
			this.confirmedText = "";
			return text;
		}
		/** ゲームパッド等から直接かなを composingKana に追加 */
		appendDirectKana(kana) {
			this.composingKana += kana;
			return this.getState();
		}
		/** confirmedText に直接テキストを挿入（改行等、composing を経由しない） */
		insertConfirmedText(text) {
			this.confirmComposition();
			this.confirmedText += text;
			return this.getState();
		}
		/** composingKana 末尾を差し替え（eager output の巻き戻し用） */
		replaceDirectKana(kana, replaceCount) {
			if (replaceCount > 0) {
				const chars = [...this.composingKana];
				this.composingKana = chars.slice(0, Math.max(0, chars.length - replaceCount)).join("");
			}
			this.composingKana += kana;
			return this.getState();
		}
		/** composingKana 末尾の濁点/半濁点/清音をトグル（か→が→か、は→ば→ぱ→は） */
		applyToggleDakuten() {
			return this.applyPostModify("cycleDakuten");
		}
		/** composingKana 末尾を拗音/小書きに変換。対象外なら「っ」を追加 */
		applyYouon() {
			return this.applyPostModify("small");
		}
		/**
		* composingKana 末尾 1 字に後置変調を適用する。
		*
		* **対象の正は「合成テキストの所有者」が持つ**（docs/keymap-v2-requirements.md D4）。
		* このエンジンが合成中はエンジンが所有者なので `composingKana` の末尾でよい。
		* 合成していないときは所有者がセッション層側なので、ここでは何もしない
		* （その経路はセッション層の postModify プリミティブの担当。別便）。
		*/
		applyPostModify(op) {
			if (this.composingKana.length === 0) return this.getState();
			const chars = [...this.composingKana];
			const last = chars[chars.length - 1];
			const next = postModify(last, op);
			if (next === null) return this.getState();
			chars[chars.length - 1] = next;
			this.composingKana = chars.join("");
			return this.getState();
		}
		/** Reset all state */
		reset() {
			this.confirmedText = "";
			this.composingKana = "";
			this.inputMode = "japanese";
			this.buffer.reset();
			this.chordBuffer?.reset();
			this.syncChordBufferMode();
		}
		/** chord バッファの参照テーブルを inputMode に同期する（iOS の syncChordBufferTables 相当） */
		syncChordBufferMode() {
			if (this.chordBuffer) this.chordBuffer.englishMode = this.inputMode === "english";
		}
		/** Whether this engine uses chord input */
		get isChord() {
			return this.chordBuffer !== null;
		}
		/** Override the simultaneous window (ms). null = use keymap default. */
		setSimultaneousWindow(ms) {
			if (this.chordBuffer) this.chordBuffer.windowOverride = ms;
		}
		setupChordBuffer(keymap) {
			if (keymap.chordData) {
				this.chordBuffer = new SimultaneousKeyBuffer(keymap.chordData);
				this.chordBuffer.hostPhase = () => this.phase;
				this.syncChordBufferMode();
				this.chordBuffer.onOutput = (text, replaceCount) => {
					if (this.inputMode === "english") {
						if (replaceCount > 0) {
							const chars = [...this.confirmedText];
							this.confirmedText = chars.slice(0, Math.max(0, chars.length - replaceCount)).join("");
						}
						this.confirmedText += text;
						this.onStateChange?.();
						return;
					}
					if (replaceCount > 0) {
						const chars = [...this.composingKana];
						const remaining = chars.slice(0, Math.max(0, chars.length - replaceCount));
						this.composingKana = remaining.join("");
					}
					if (text.length > 0) this.composingKana += text;
					this.onStateChange?.();
				};
				this.chordBuffer.onShiftSingle = (action) => {
					this.executeAction(action);
					this.onStateChange?.();
				};
				this.chordBuffer.onSpecialAction = (action) => {
					this.executeAction(action);
					this.onStateChange?.();
				};
			} else this.chordBuffer = null;
		}
		executeAction(action) {
			switch (action.type) {
				case "printable":
					this.handlePrintable(action.char);
					break;
				case "confirm":
					if (this.onHostAction?.(action)) break;
					this.confirmComposition();
					break;
				case "cancel":
					this.cancelComposition();
					break;
				case "deleteBack":
					if (this.onHostAction?.(action)) break;
					this.handleDeleteBack();
					break;
				case "toggleInputMode":
					this.confirmComposition();
					this.chordBuffer?.reset();
					this.inputMode = this.inputMode === "japanese" ? "english" : "japanese";
					this.syncChordBufferMode();
					break;
				case "switchToEnglish":
					this.confirmComposition();
					this.chordBuffer?.reset();
					this.inputMode = "english";
					this.syncChordBufferMode();
					break;
				case "switchToJapanese":
					this.chordBuffer?.reset();
					this.inputMode = "japanese";
					this.syncChordBufferMode();
					break;
				case "insertAndConfirm":
					if (this.onHostAction?.(action)) break;
					this.composingKana += action.text;
					this.confirmComposition();
					break;
				case "directInsert":
					this.confirmedText += action.text;
					break;
				case "insertSpace":
					if (this.onHostAction?.(action)) break;
					if (this.inputMode === "japanese") this.confirmedText += action.shifted ? " " : "　";
					else this.confirmedText += " ";
					break;
				case "convert":
					if (this.onHostAction?.(action)) break;
					if (this.composingKana.length > 0 || !this.buffer.isEmpty) this.confirmComposition();
					else this.executeAction({
						type: "insertSpace",
						shifted: false
					});
					break;
				case "chordInput":
					this.chordBuffer?.keyDown(action.key);
					break;
				case "chordShiftDown":
					this.chordBuffer?.keyDown(action.key);
					break;
				case "chordKeyUp":
					this.chordBuffer?.keyUp(action.key);
					break;
				case "moveLeft":
				case "moveRight":
				case "moveUp":
				case "moveDown":
				case "editSegmentLeft":
				case "editSegmentRight":
					if (this.onHostAction?.(action)) break;
					this.confirmComposition();
					break;
				case "postModify":
					if (this.isComposing) this.applyPostModify(action.op);
					else this.onHostAction?.(action);
					break;
				case "pass": break;
			}
		}
		handlePrintable(char) {
			const logical = this.keymap.keyRemap[char] ?? char;
			const charMapResult = this.keymap.characterMap[logical];
			if (charMapResult && !this.wouldBufferHandle(logical)) {
				if (!/^[a-zA-Z]$/.test(logical)) {
					this.composingKana += charMapResult;
					return;
				}
			}
			const resolved = this.buffer.input(logical);
			if (resolved) this.composingKana += resolved;
		}
		/** Check if the sequential buffer's inputMappings would handle this character */
		wouldBufferHandle(char) {
			const testBuf = this.buffer.pending + char;
			return this.keymap.prefixSet.has(testBuf) || this.keymap.inputMappings[testBuf] !== void 0;
		}
		confirmComposition() {
			const remaining = this.buffer.flush();
			if (remaining) this.composingKana += remaining;
			if (this.composingKana.length > 0) {
				this.confirmedText += this.composingKana;
				this.composingKana = "";
			}
			this.chordBuffer?.reset();
		}
		cancelComposition() {
			this.composingKana = "";
			this.buffer.reset();
			this.chordBuffer?.reset();
		}
		/**
		* BS で「素通しされた未解決ローマ字」まで戻ったとき、それを逐次バッファへ復帰させる (v1.6.0)。
		*
		* greedy マッチは語彙外の先頭を素通しで composingKana に積む（例: dka → 「dか」。
		* dk が語彙外なので d が素通しされた）。BS で「d」まで戻してもそれは解決済みかな扱いに
		* なり、続く a が「dあ」になってしまう。実 IME は未解決チャンクの raw を保つので「だ」に
		* なる — その挙動に合わせる。hechima セッション層（内蔵ローマ字）の v0.13.1 と同じ設計で、
		* 戻すのは「続きを待てる」最長の末尾だけ（kt なら t、sh なら sh）。
		*/
		repend() {
			if (!this.buffer.isEmpty) return;
			const run = /[a-zA-Z]+$/.exec(this.composingKana)?.[0];
			if (!run) return;
			for (let i = 0; i < run.length; i++) {
				const tail = run.slice(i);
				if (this.keymap.prefixSet.has(tail)) {
					this.composingKana = this.composingKana.slice(0, this.composingKana.length - tail.length);
					this.buffer.restore(tail);
					return;
				}
			}
		}
		handleDeleteBack() {
			if (this.buffer.deleteBack()) return;
			if (this.composingKana.length > 0) {
				const chars = [...this.composingKana];
				chars.pop();
				this.composingKana = chars.join("");
				this.repend();
				return;
			}
			if (this.confirmedText.length > 0) {
				const chars = [...this.confirmedText];
				chars.pop();
				this.confirmedText = chars.join("");
			}
		}
	};
	//#endregion
	//#region src/engine/index.ts
	/** このバンドルのバージョン（取り込み側が記録する用） */
	const version = ENGINE_VERSION;
	/** サポートする keymap-format のメジャーバージョン */
	const SUPPORTED_MAJOR = 2;
	/**
	* keymap JSON を検証しつつ ExpandedKeymap に変換する。
	* `InputEngine` のコンストラクタにそのまま渡せる形。
	*
	* - `formatVersion` のメジャーが非対応なら明確なエラーを投げる。
	* - `behavior.type` が未対応（sequential / chord 以外）ならデコーダがエラーを投げる。
	* - `judgment` が未知の値ならエラーを投げる（v1.10.0。旧版は黙って window に潰していた）。
	* - `requires` に理解できないセマンティクス名があればエラーを投げる（v1.11.0）。
	* - `opts.onDiagnostic` を渡すと、**解釈できずに捨てたエントリ**を報告する
	*   （未知のキー名・その面では書けないアクション・壊れたパラメータ等）。
	*   省略時は従来どおり黙って捨てる。
	*/
	function decodeKeymap(json, opts = {}) {
		if (json === null || typeof json !== "object") throw new Error("KeymapEngine.decodeKeymap: keymap JSON オブジェクトを渡してください");
		const obj = json;
		assertFormatVersion(obj.formatVersion);
		return expandKeymap(decodeKeymap$1(obj, opts), opts);
	}
	function assertFormatVersion(raw) {
		const v = typeof raw === "string" && raw.length > 0 ? raw : "";
		const major = Number.parseInt(v.split(".")[0], 10);
		if (!Number.isFinite(major) || major !== SUPPORTED_MAJOR) throw new Error(`KeymapEngine: 非対応の formatVersion "${v}"（このエンジンは ${SUPPORTED_MAJOR}.x に対応）`);
	}
	/**
	* DOM KeyboardEvent 風オブジェクトからエンジン内部の `KeyEvent` を組み立てる便宜関数。
	* `KeyboardEvent.code` が変換テーブルに無い場合は `null`（呼び元は透過扱いにする）。
	*
	* 生の変換テーブルが必要なら `browserCodeToHID` / `hidNameToCode` を直接使う。
	*/
	function keyEventFromBrowser(e) {
		const keyCode = browserCodeToHID(e.code);
		if (keyCode === void 0) return null;
		let modifiers = 0;
		if (e.shiftKey) modifiers |= KeyModifierFlags.SHIFT;
		if (e.ctrlKey) modifiers |= KeyModifierFlags.CONTROL;
		if (e.altKey) modifiers |= KeyModifierFlags.ALT;
		if (e.metaKey) modifiers |= KeyModifierFlags.META;
		return {
			keyCode,
			characters: typeof e.key === "string" && e.key.length === 1 ? e.key : "",
			modifiers
		};
	}
	//#endregion
	exports.InputEngine = InputEngine;
	exports.KeyModifierFlags = KeyModifierFlags;
	exports.SUPPORTED_SEMANTICS = SUPPORTED_SEMANTICS;
	exports.browserCodeToHID = browserCodeToHID;
	exports.collectDiagnostics = collectDiagnostics;
	exports.createBuiltinRomajiJIS = createBuiltinRomajiJIS;
	exports.createBuiltinRomajiUS = createBuiltinRomajiUS;
	exports.decodeKeymap = decodeKeymap;
	exports.decodeKeymapDefinition = decodeKeymap$1;
	exports.expandKeymap = expandKeymap;
	exports.hidCodeToName = hidCodeToName;
	exports.hidNameToBrowserCode = hidNameToBrowserCode;
	exports.hidNameToCode = hidNameToCode;
	exports.isSatisfiedBy = isSatisfiedBy;
	exports.keyEventFromBrowser = keyEventFromBrowser;
	exports.requiredInputLevel = requiredInputLevel;
	exports.version = version;
});
