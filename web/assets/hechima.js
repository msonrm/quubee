(function(global, factory) {
	typeof exports === "object" && typeof module !== "undefined" ? factory(exports) : typeof define === "function" && define.amd ? define(["exports"], factory) : (global = typeof globalThis !== "undefined" ? globalThis : global || self, factory(global.Hechima = {}));
})(this, function(exports) {
	Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
	//#region src/hechima/version.ts
	const HECHIMA_VERSION = "0.1.0";
	//#endregion
	//#region src/hechima/session.ts
	const ROMAJI = {
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
		ga: "が",
		gi: "ぎ",
		gu: "ぐ",
		ge: "げ",
		go: "ご",
		sa: "さ",
		si: "し",
		su: "す",
		se: "せ",
		so: "そ",
		za: "ざ",
		zi: "じ",
		zu: "ず",
		ze: "ぜ",
		zo: "ぞ",
		ta: "た",
		ti: "ち",
		tu: "つ",
		te: "て",
		to: "と",
		da: "だ",
		di: "ぢ",
		du: "づ",
		de: "で",
		do: "ど",
		na: "な",
		ni: "に",
		nu: "ぬ",
		ne: "ね",
		no: "の",
		n: "ん",
		"n'": "ん",
		ha: "は",
		hi: "ひ",
		hu: "ふ",
		he: "へ",
		ho: "ほ",
		fu: "ふ",
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
		wo: "を",
		wi: "うぃ",
		we: "うぇ",
		kya: "きゃ",
		kyu: "きゅ",
		kyo: "きょ",
		kye: "きぇ",
		gya: "ぎゃ",
		gyu: "ぎゅ",
		gyo: "ぎょ",
		sha: "しゃ",
		shi: "し",
		shu: "しゅ",
		she: "しぇ",
		sho: "しょ",
		sya: "しゃ",
		syu: "しゅ",
		syo: "しょ",
		ja: "じゃ",
		ji: "じ",
		ju: "じゅ",
		je: "じぇ",
		jo: "じょ",
		jya: "じゃ",
		jyu: "じゅ",
		jyo: "じょ",
		zya: "じゃ",
		zyu: "じゅ",
		zyo: "じょ",
		cha: "ちゃ",
		chi: "ち",
		chu: "ちゅ",
		che: "ちぇ",
		cho: "ちょ",
		tya: "ちゃ",
		tyu: "ちゅ",
		tyo: "ちょ",
		dya: "ぢゃ",
		dyu: "ぢゅ",
		dyo: "ぢょ",
		tsu: "つ",
		tsa: "つぁ",
		tsi: "つぃ",
		tse: "つぇ",
		tso: "つぉ",
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
		nya: "にゃ",
		nyu: "にゅ",
		nyo: "にょ",
		hya: "ひゃ",
		hyu: "ひゅ",
		hyo: "ひょ",
		fa: "ふぁ",
		fi: "ふぃ",
		fe: "ふぇ",
		fo: "ふぉ",
		bya: "びゃ",
		byu: "びゅ",
		byo: "びょ",
		pya: "ぴゃ",
		pyu: "ぴゅ",
		pyo: "ぴょ",
		mya: "みゃ",
		myu: "みゅ",
		myo: "みょ",
		rya: "りゃ",
		ryu: "りゅ",
		ryo: "りょ",
		va: "ヴァ",
		vi: "ヴィ",
		vu: "ヴ",
		ve: "ヴェ",
		vo: "ヴォ",
		qa: "くぁ",
		qi: "くぃ",
		qe: "くぇ",
		qo: "くぉ",
		xa: "ぁ",
		xi: "ぃ",
		xu: "ぅ",
		xe: "ぇ",
		xo: "ぉ",
		la: "ぁ",
		li: "ぃ",
		lu: "ぅ",
		le: "ぇ",
		lo: "ぉ",
		xya: "ゃ",
		xyu: "ゅ",
		xyo: "ょ",
		lya: "ゃ",
		lyu: "ゅ",
		lyo: "ょ",
		xtu: "っ",
		xtsu: "っ",
		ltu: "っ",
		ltsu: "っ",
		xwa: "ゎ",
		lwa: "ゎ",
		"-": "ー",
		",": "、",
		".": "。",
		"[": "「",
		"]": "」",
		"?": "？",
		"!": "！",
		"/": "・"
	};
	const DIRECT_COMMIT = {
		".": "。",
		",": "、",
		"?": "？",
		"!": "！",
		"[": "「",
		"]": "」",
		"-": "ー",
		"/": "・"
	};
	const HOST_NAV_KEYS = /* @__PURE__ */ new Set([
		"Backspace",
		"Delete",
		"ArrowLeft",
		"ArrowRight",
		"ArrowUp",
		"ArrowDown",
		"Home",
		"End",
		"PageUp",
		"PageDown",
		"Enter",
		"Tab",
		"Escape"
	]);
	const PREFIXES = /* @__PURE__ */ new Set(["nn"]);
	for (const k of Object.keys(ROMAJI)) for (let i = 1; i < k.length; i++) PREFIXES.add(k.slice(0, i));
	const isVowelY = (c) => c !== void 0 && "aiueoy".includes(c);
	const isCons = (c) => c !== void 0 && /[bcdfghjklmpqrstvwxz]/.test(c);
	function resolveRomaji(kana, pend, flush) {
		for (;;) {
			if (!pend) break;
			const exact = Object.prototype.hasOwnProperty.call(ROMAJI, pend);
			const wait = PREFIXES.has(pend);
			if (!flush && wait) break;
			if (exact) {
				kana += ROMAJI[pend];
				pend = "";
				break;
			}
			if (pend[0] === "n") {
				if (pend[1] === "n") {
					if (isVowelY(pend[2])) {
						kana += "ん";
						pend = pend.slice(1);
						continue;
					}
					kana += "ん";
					pend = pend.slice(2);
					continue;
				}
				kana += "ん";
				pend = pend.slice(1);
				continue;
			}
			if (pend.length >= 2 && pend[0] === pend[1] && isCons(pend[0])) {
				kana += "っ";
				pend = pend.slice(1);
				continue;
			}
			kana += pend[0];
			pend = pend.slice(1);
		}
		return {
			kana,
			pend
		};
	}
	function toKatakana(s) {
		let out = "";
		for (const ch of s) {
			const c = ch.codePointAt(0) ?? 0;
			out += c >= 12353 && c <= 12438 ? String.fromCodePoint(c + 96) : ch;
		}
		return out;
	}
	function fallbackConvert(yomi) {
		const kata = toKatakana(yomi);
		return [{
			key: yomi,
			candidates: kata !== yomi ? [kata, yomi] : [yomi]
		}];
	}
	/**
	* 変換セッションを作る。cb は SessionCallbacks（QuuBee 実証済みの 5 点契約）。
	*
	* よみ入力 → 変換 (非同期・世代トークンで in-flight 破棄) → 複数文節の候補選択
	* (←→ 移動・↑↓/Space 候補・Enter 結合確定) → 確定、を 1 つの状態機械で持つ。
	*/
	function createFep(cb) {
		let active = false;
		let kana = "";
		let pend = "";
		let segs = null;
		let focus = 0;
		let genId = 0;
		const composing = () => (kana + pend).length > 0;
		const clear = () => {
			kana = "";
			pend = "";
			segs = null;
			focus = 0;
			genId++;
		};
		const backToYomi = () => {
			segs = null;
			focus = 0;
			genId++;
		};
		function render() {
			if (segs) cb.show(segs.map((s, i) => ({
				text: s.candidates[s.idx],
				kind: i === focus ? "focus" : "other"
			})));
			else if (composing()) cb.show([{
				text: kana + pend,
				kind: "yomi"
			}]);
			else cb.hide();
		}
		const joined = () => (segs ?? []).map((s) => s.candidates[s.idx]).join("");
		function commit(text) {
			clear();
			cb.commit(text);
		}
		function startConvert() {
			kana = resolveRomaji(kana, pend, true).kana;
			pend = "";
			render();
			const yomi = kana;
			const gen = ++genId;
			Promise.resolve(cb.convert ? cb.convert(yomi) : null).then((result) => {
				if (gen !== genId || !composing() || kana !== yomi) return;
				if (!result || !result.length) result = fallbackConvert(yomi);
				segs = result.map((s) => ({
					key: s.key,
					candidates: s.candidates && s.candidates.length ? s.candidates : [s.key],
					idx: 0
				}));
				focus = 0;
				render();
			}).catch(() => {});
		}
		let engine = null;
		let engineKeyOf = null;
		function pumpEngine() {
			if (!engine || segs) return;
			const confirmed = engine.takeConfirmedText();
			if (confirmed) {
				if (engine.getState().inputMode === "english") {
					cb.commit(confirmed);
					return;
				}
				kana += confirmed;
				pend = "";
				startConvert();
				return;
			}
			const st = engine.getState();
			if (st.isComposing) cb.show([{
				text: st.composingKana + st.pendingDisplay,
				kind: "yomi"
			}]);
			else if (!(kana || pend)) cb.hide();
		}
		function navCandidates(tap) {
			const k = tap.key;
			const cur = segs;
			if (!cur) return false;
			if (k === "Enter") {
				commit(joined());
				return true;
			}
			if (k === "Escape" || k === "Backspace") {
				clear();
				engine?.reset();
				cb.hide();
				return true;
			}
			if (k === " ") {
				const s = cur[focus];
				s.idx = (s.idx + 1) % s.candidates.length;
				render();
				return true;
			}
			if (k === "ArrowLeft" || k === "ArrowRight") {
				if (cur.length > 1) focus = (focus + (k === "ArrowRight" ? 1 : cur.length - 1)) % cur.length;
				render();
				return true;
			}
			if (k === "ArrowUp" || k === "ArrowDown") {
				const s = cur[focus];
				s.idx = (s.idx + (k === "ArrowDown" ? 1 : s.candidates.length - 1)) % s.candidates.length;
				render();
				return true;
			}
			commit(joined());
			return engineDown(tap);
		}
		function handleEngineAction(action) {
			const t = action.type;
			if (t !== "moveLeft" && t !== "moveRight" && t !== "deleteBack") return false;
			if (segs) {
				if (t === "deleteBack") {
					clear();
					engine?.reset();
					cb.hide();
					return true;
				}
				if (segs.length > 1) focus = (focus + (t === "moveRight" ? 1 : segs.length - 1)) % segs.length;
				render();
				return true;
			}
			if (engine && engine.getState().isComposing) {
				if (t === "deleteBack") return false;
				return true;
			}
			if (cb.hostKey) cb.hostKey(t === "deleteBack" ? "Backspace" : t === "moveRight" ? "ArrowRight" : "ArrowLeft");
			return true;
		}
		function engineDown(tap) {
			if (!engine) return false;
			if (segs) return navCandidates(tap);
			if (tap.ctrlKey || tap.altKey || tap.metaKey) return false;
			if (tap.repeat) return true;
			if (!engine.getState().isComposing && tap.code !== void 0 && HOST_NAV_KEYS.has(tap.code)) return false;
			const kev = engineKeyOf ? engineKeyOf(tap) : null;
			if (!kev) return false;
			engine.processKey(kev);
			pumpEngine();
			return true;
		}
		function engineUp(tap) {
			if (!engine) return false;
			if (tap.ctrlKey || tap.altKey || tap.metaKey) return false;
			const kev = engineKeyOf ? engineKeyOf(tap) : null;
			if (kev) {
				engine.processKeyUp(kev);
				pumpEngine();
			}
			return false;
		}
		function feed(e) {
			if (!active) return false;
			if (engine) return engineDown(e);
			if (e.ctrlKey || e.altKey || e.metaKey) return false;
			const k = e.key;
			if (k === "Enter") {
				if (!composing()) return false;
				commit(segs ? joined() : resolveRomaji(kana, pend, true).kana);
				return true;
			}
			if (k === "Escape") {
				if (!composing()) return false;
				if (segs) backToYomi();
				else clear();
				render();
				return true;
			}
			if (k === "Backspace") {
				if (!composing()) return false;
				if (segs) backToYomi();
				else if (pend) pend = pend.slice(0, -1);
				else kana = Array.from(kana).slice(0, -1).join("");
				render();
				return true;
			}
			if (k === " ") {
				if (!composing()) return false;
				if (segs) {
					const s = segs[focus];
					s.idx = (s.idx + 1) % s.candidates.length;
					render();
				} else startConvert();
				return true;
			}
			if (k === "ArrowLeft" || k === "ArrowRight") {
				if (!composing()) return false;
				if (segs && segs.length > 1) {
					focus = (focus + (k === "ArrowRight" ? 1 : segs.length - 1)) % segs.length;
					render();
				}
				return true;
			}
			if (k === "ArrowUp" || k === "ArrowDown") {
				if (!composing()) return false;
				if (segs) {
					const s = segs[focus];
					const d = k === "ArrowDown" ? 1 : s.candidates.length - 1;
					s.idx = (s.idx + d) % s.candidates.length;
					render();
				}
				return true;
			}
			if (k.length === 1 && k >= " " && k <= "~") {
				const ch = k.toLowerCase();
				if (!composing() && !/[a-z]/.test(ch)) {
					if (DIRECT_COMMIT[ch]) {
						commit(DIRECT_COMMIT[ch]);
						return true;
					}
					return false;
				}
				if (segs) commit(joined());
				pend += ch;
				const r = resolveRomaji(kana, pend, false);
				kana = r.kana;
				pend = r.pend;
				genId++;
				render();
				return true;
			}
			return composing();
		}
		return {
			get active() {
				return active;
			},
			setActive(on) {
				on = !!on;
				if (active && !on && composing()) {
					clear();
					cb.hide();
				}
				active = on;
				return active;
			},
			toggle() {
				return this.setActive(!active);
			},
			feed,
			feedUp(e) {
				return engine ? engineUp(e) : false;
			},
			setEngine(eng, keyOf) {
				if (engine && engine !== eng) {
					try {
						engine.reset();
					} catch {}
					engine.onHostAction = null;
				}
				clear();
				cb.hide();
				engine = eng ?? null;
				engineKeyOf = keyOf ?? null;
				if (engine) engine.onHostAction = (action) => handleEngineAction(action);
			},
			pumpEngine,
			reset() {
				clear();
				if (engine) try {
					engine.reset();
				} catch {}
			}
		};
	}
	//#endregion
	//#region src/hechima/index.ts
	/** このバンドルのバージョン（取り込み側が記録する用） */
	const version = HECHIMA_VERSION;
	//#endregion
	exports.createFep = createFep;
	exports.fallbackConvert = fallbackConvert;
	exports.resolveRomaji = resolveRomaji;
	exports.version = version;
});
