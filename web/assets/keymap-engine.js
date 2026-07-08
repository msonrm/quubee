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
	/** Parse a raw JSON object into a KeymapDefinition */
	function decodeKeymap$1(json) {
		const behavior = json.behavior;
		if (!behavior || behavior.type !== "sequential" && behavior.type !== "chord") throw new Error(`Unsupported behavior type: ${behavior?.type}`);
		const modeKeys = decodeModeKeys(json.modeKeys);
		const prefixShiftKeys = json.prefixShiftKeys;
		const common = {
			formatVersion: json.formatVersion || "1.0",
			name: json.name,
			description: json.description,
			author: json.author,
			contributor: json.contributor,
			basedOn: json.basedOn,
			license: json.license,
			keyboardLayout: json.keyboardLayout,
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
				simultaneousWindow: config.simultaneousWindow ?? .1
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
	function decodeModeKeys(raw) {
		if (!raw) return [];
		const entries = [];
		for (const [keyStr, actionStr] of Object.entries(raw)) {
			const trigger = decodeModeKeyTrigger(keyStr);
			if (!trigger) continue;
			const action = decodeKeyAction(actionStr);
			if (!action) continue;
			entries.push({
				trigger,
				action
			});
		}
		return entries;
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
	function decodeKeyAction(str) {
		switch (str) {
			case "convert": return { type: "convert" };
			case "confirm": return { type: "confirm" };
			case "cancel": return { type: "cancel" };
			case "deleteBack": return { type: "deleteBack" };
			case "switchToEnglish": return { type: "switchToEnglish" };
			case "switchToJapanese": return { type: "switchToJapanese" };
			case "toggleInputMode": return { type: "toggleInputMode" };
			case "pass": return { type: "pass" };
			default: return null;
		}
	}
	/** Filter out _comment keys from inputMappings */
	function filterComments(mappings) {
		if (!mappings) return void 0;
		const result = {};
		for (const [k, v] of Object.entries(mappings)) if (!k.startsWith("_comment")) result[k] = v;
		return Object.keys(result).length > 0 ? result : void 0;
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
	function expandKeymap(def) {
		const inputMappings = expandInputMappings(def.inputBase, def.suffixRules, def.inputMappings);
		const prefixSet = buildPrefixSet(inputMappings);
		const characterMap = def.behavior.type === "sequential" ? def.behavior.characterMap : {};
		const chordData = def.behavior.type === "chord" ? expandChordData(def.behavior.config) : void 0;
		return {
			definition: def,
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
	/** Parse a special action string → KeyAction */
	function parseSpecialAction(str) {
		switch (str) {
			case "deleteBack": return { type: "deleteBack" };
			case "confirm": return { type: "confirm" };
			case "cancel": return { type: "cancel" };
			case "convert": return { type: "convert" };
			case "moveLeft": return { type: "moveLeft" };
			case "moveRight": return { type: "moveRight" };
			case "moveUp": return { type: "moveUp" };
			case "moveDown": return { type: "moveDown" };
			case "switchToEnglish": return { type: "switchToEnglish" };
			case "switchToJapanese": return { type: "switchToJapanese" };
			case "editSegmentLeft": return { type: "editSegmentLeft" };
			case "editSegmentRight": return { type: "editSegmentRight" };
			default:
				if (str.startsWith("insertAndConfirm:")) return {
					type: "insertAndConfirm",
					text: str.slice(17)
				};
				return null;
		}
	}
	/** Expand chord config into ExpandedChordData */
	function expandChordData(config) {
		const keyBits = /* @__PURE__ */ new Map();
		for (const [name, idx] of Object.entries(CHORD_KEY_BIT_INDEX)) keyBits.set(name, 2 ** idx);
		const hidToChordKey = /* @__PURE__ */ new Map();
		for (const [hidName, chordKeyName] of Object.entries(config.hidToKey)) {
			const hid = hidNameToCode(hidName);
			if (hid !== void 0) hidToChordKey.set(hid, chordKeyName);
		}
		const lookupTable = /* @__PURE__ */ new Map();
		for (const [keyStr, output] of Object.entries(config.lookupTable)) {
			const bits = parseLookupKey(keyStr, keyBits);
			if (bits !== void 0) lookupTable.set(bits, output);
		}
		const specialActions = /* @__PURE__ */ new Map();
		for (const [keyStr, actionStr] of Object.entries(config.specialActions)) {
			const bits = parseLookupKey(keyStr, keyBits);
			const action = parseSpecialAction(actionStr);
			if (bits !== void 0 && action) specialActions.set(bits, action);
		}
		const shiftKeys = /* @__PURE__ */ new Set();
		const shiftSingleTapActions = /* @__PURE__ */ new Map();
		for (const sk of config.shiftKeys) {
			shiftKeys.add(sk.key);
			if (sk.singleTapAction) {
				const action = parseSpecialAction(sk.singleTapAction);
				if (action) shiftSingleTapActions.set(sk.key, action);
			}
		}
		return {
			hidToChordKey,
			lookupTable,
			specialActions,
			shiftKeys,
			shiftSingleTapActions,
			keyBits,
			simultaneousWindow: Math.round(config.simultaneousWindow * 1e3)
		};
	}
	//#endregion
	//#region src/engine/version.ts
	const ENGINE_VERSION = "1.0.0";
	//#endregion
	//#region src/engine/key-router.ts
	/** Route a KeyEvent to a KeyAction based on the expanded keymap */
	function routeKey(event, keymap, isComposing, state, isDirectEnglishMode) {
		const modeAction = matchModeKey(event, keymap);
		if (modeAction) return modeAction;
		if (event.keyCode === HID.BACKSPACE && !(event.modifiers & (KeyModifierFlags.META | KeyModifierFlags.ALT))) return { type: "deleteBack" };
		if (isComposing && event.modifiers & KeyModifierFlags.CONTROL) return routeControlKey(event);
		if (isComposing) {
			const ctrlAction = routeStandardControlKey(event, state, keymap.chordData ? isChordShiftKeyCode(event.keyCode, keymap.chordData) : false);
			if (ctrlAction) return ctrlAction;
		}
		if (keymap.chordData) return routeChord(event, keymap.chordData, isDirectEnglishMode);
		if (!isComposing && !isDirectEnglishMode && event.keyCode === HID.SPACE) return {
			type: "insertSpace",
			shifted: !!(event.modifiers & KeyModifierFlags.SHIFT)
		};
		return routeSequential(event, keymap, isComposing, isDirectEnglishMode);
	}
	/** Match modeKeys triggers */
	function matchModeKey(event, keymap) {
		const eventMods = event.modifiers & (KeyModifierFlags.SHIFT | KeyModifierFlags.CONTROL | KeyModifierFlags.ALT);
		for (const entry of keymap.modeKeys) {
			const t = entry.trigger;
			if (t.keyCode !== event.keyCode) continue;
			if (t.modifiers !== 0) {
				if (t.modifiers === eventMods) return entry.action;
			} else return entry.action;
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
			case HID.SPACE: return { type: "confirm" };
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
		const chars = event.characters;
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
	var SimultaneousKeyBuffer = class {
		constructor(chord) {
			this.state = { type: "idle" };
			this.timerId = null;
			this.pressedKeys = /* @__PURE__ */ new Set();
			this.windowOverride = null;
			this.onOutput = null;
			this.onShiftSingle = null;
			this.onSpecialAction = null;
			this.chord = chord;
		}
		/** Process key down */
		keyDown(key) {
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
			this.pressedKeys.delete(key);
			if (this.state.type === "shiftHeld" && this.state.shiftKey === key) {
				if (!this.state.used) {
					const action = this.chord.shiftSingleTapActions.get(key);
					if (action) this.onShiftSingle?.(action);
				}
				this.state = { type: "idle" };
			}
		}
		/** Reset buffer */
		reset() {
			this.cancelTimer();
			this.state = { type: "idle" };
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
				const singleChar = this.chord.lookupTable.get(bits);
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
			const specialAction = this.chord.specialActions.get(combined);
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
			const simultaneousResult = this.chord.lookupTable.get(combined);
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
					const action = this.chord.shiftSingleTapActions.get(firstKey);
					if (action) this.onShiftSingle?.(action);
				} else {
					const firstBits = this.getBit(firstKey);
					const pendingAction2 = firstBits ? this.chord.specialActions.get(firstBits) : null;
					if (pendingAction2) this.onSpecialAction?.(pendingAction2);
				}
				this.state = { type: "idle" };
				this.handleFirstKey(key);
			} else {
				const keys = /* @__PURE__ */ new Set([firstKey, key]);
				const singleChar = this.chord.lookupTable.get(keyBit);
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
			const tripleResult = this.chord.lookupTable.get(tripleKeys);
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
			const specialAction = this.chord.specialActions.get(combined);
			if (specialAction) {
				this.onSpecialAction?.(specialAction);
				this.state = {
					type: "shiftHeld",
					shiftKey,
					used: true
				};
				return;
			}
			const shifted = this.chord.lookupTable.get(combined);
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
				const action = this.chord.shiftSingleTapActions.get(shiftKey);
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
						const action = this.chord.shiftSingleTapActions.get(firstKey);
						if (action) this.onShiftSingle?.(action);
						this.state = { type: "idle" };
					}
					else {
						const bits = this.getBit(firstKey);
						if (bits) {
							const pendingAction = this.chord.specialActions.get(bits);
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
	//#region src/engine/input-engine.ts
	var InputEngine = class {
		constructor(keymap) {
			this.confirmedText = "";
			this.composingKana = "";
			this.inputMode = "japanese";
			this.buffer = new SequentialBuffer();
			this.chordBuffer = null;
			this.onStateChange = null;
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
			const action = routeKey(event, this.keymap, isComposing, state, isEnglish);
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
		getState() {
			const isComposing = this.composingKana.length > 0 || !this.buffer.isEmpty;
			return {
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
			if (this.composingKana.length === 0) return this.getState();
			const chars = [...this.composingKana];
			const last = chars[chars.length - 1];
			const seionFromHandakuten = HANDAKUTEN_REVERSE.get(last);
			if (seionFromHandakuten) {
				chars[chars.length - 1] = seionFromHandakuten;
				this.composingKana = chars.join("");
				return this.getState();
			}
			const seionFromDakuten = DAKUTEN_REVERSE.get(last);
			if (seionFromDakuten) {
				const handakuten = HANDAKUTEN_MAP.get(seionFromDakuten);
				if (handakuten) chars[chars.length - 1] = handakuten;
				else chars[chars.length - 1] = seionFromDakuten;
				this.composingKana = chars.join("");
				return this.getState();
			}
			const dakuten = DAKUTEN_MAP.get(last);
			if (dakuten) {
				chars[chars.length - 1] = dakuten;
				this.composingKana = chars.join("");
			}
			return this.getState();
		}
		/** composingKana 末尾を拗音/小書きに変換。対象外なら「っ」を追加 */
		applyYouon() {
			if (this.composingKana.length === 0) return this.getState();
			const chars = [...this.composingKana];
			const last = chars[chars.length - 1];
			const replaced = YOUON_POSTSHIFT_MAP.get(last);
			if (replaced) {
				chars[chars.length - 1] = replaced[0];
				this.composingKana = chars.join("") + replaced.slice(1);
			} else this.composingKana += "っ";
			return this.getState();
		}
		/** Reset all state */
		reset() {
			this.confirmedText = "";
			this.composingKana = "";
			this.inputMode = "japanese";
			this.buffer.reset();
			this.chordBuffer?.reset();
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
				this.chordBuffer.onOutput = (text, replaceCount) => {
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
					this.confirmComposition();
					break;
				case "cancel":
					this.cancelComposition();
					break;
				case "deleteBack":
					this.handleDeleteBack();
					break;
				case "toggleInputMode":
					this.confirmComposition();
					this.chordBuffer?.reset();
					this.inputMode = this.inputMode === "japanese" ? "english" : "japanese";
					break;
				case "switchToEnglish":
					this.confirmComposition();
					this.chordBuffer?.reset();
					this.inputMode = "english";
					break;
				case "switchToJapanese":
					this.chordBuffer?.reset();
					this.inputMode = "japanese";
					break;
				case "insertAndConfirm":
					this.composingKana += action.text;
					this.confirmComposition();
					break;
				case "directInsert":
					this.confirmedText += action.text;
					break;
				case "insertSpace":
					if (this.inputMode === "japanese") this.confirmedText += action.shifted ? " " : "　";
					else this.confirmedText += " ";
					break;
				case "convert":
					if (this.composingKana.length > 0 || !this.buffer.isEmpty) this.confirmComposition();
					else this.confirmedText += this.inputMode === "japanese" ? "　" : " ";
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
					this.confirmComposition();
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
		handleDeleteBack() {
			if (this.buffer.deleteBack()) return;
			if (this.composingKana.length > 0) {
				const chars = [...this.composingKana];
				chars.pop();
				this.composingKana = chars.join("");
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
	const SUPPORTED_MAJOR = 1;
	/**
	* keymap JSON を検証しつつ ExpandedKeymap に変換する。
	* `InputEngine` のコンストラクタにそのまま渡せる形。
	*
	* - `formatVersion` のメジャーが非対応なら明確なエラーを投げる。
	* - `behavior.type` が未対応（sequential / chord 以外）ならデコーダがエラーを投げる。
	*/
	function decodeKeymap(json) {
		if (json === null || typeof json !== "object") throw new Error("KeymapEngine.decodeKeymap: keymap JSON オブジェクトを渡してください");
		const obj = json;
		assertFormatVersion(obj.formatVersion);
		return expandKeymap(decodeKeymap$1(obj));
	}
	function assertFormatVersion(raw) {
		const v = typeof raw === "string" && raw.length > 0 ? raw : "1.0";
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
	exports.browserCodeToHID = browserCodeToHID;
	exports.createBuiltinRomajiJIS = createBuiltinRomajiJIS;
	exports.createBuiltinRomajiUS = createBuiltinRomajiUS;
	exports.decodeKeymap = decodeKeymap;
	exports.decodeKeymapDefinition = decodeKeymap$1;
	exports.expandKeymap = expandKeymap;
	exports.hidCodeToName = hidCodeToName;
	exports.hidNameToBrowserCode = hidNameToBrowserCode;
	exports.hidNameToCode = hidNameToCode;
	exports.keyEventFromBrowser = keyEventFromBrowser;
	exports.version = version;
});
