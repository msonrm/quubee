(function(global, factory) {
	typeof exports === "object" && typeof module !== "undefined" ? factory(exports) : typeof define === "function" && define.amd ? define(["exports"], factory) : (global = typeof globalThis !== "undefined" ? globalThis : global || self, factory(global.Hechima = {}));
})(this, function(exports) {
	Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
	//#region src/hechima/version.ts
	const HECHIMA_VERSION = "0.12.0";
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
	function toZenkakuAscii(s) {
		let out = "";
		for (const ch of s) {
			const c = ch.codePointAt(0) ?? 0;
			out += ch === " " ? "　" : c >= 33 && c <= 126 ? String.fromCodePoint(c + 65248) : ch;
		}
		return out;
	}
	function eijiVariants(raw) {
		const lower = raw.toLowerCase();
		const capital = lower ? lower[0].toUpperCase() + lower.slice(1) : lower;
		return [{
			key: raw,
			candidates: [
				raw,
				lower,
				raw.toUpperCase(),
				capital,
				toZenkakuAscii(raw)
			]
		}];
	}
	function mergeEijiConvert(raw, result) {
		const variants = eijiVariants(raw)[0].candidates ?? [raw];
		let engineCands = [];
		if (result && result.length === 1 && result[0].key === raw) engineCands = (result[0].candidates ?? []).filter((c) => c !== raw);
		return [{
			key: raw,
			candidates: [
				variants[0],
				...engineCands,
				...variants.slice(1)
			]
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
		let eiji = false;
		let addlShown = 0;
		let addlSel = null;
		const composing = () => (kana + pend).length > 0;
		const resetAddl = () => {
			addlShown = 0;
			addlSel = null;
		};
		const clear = () => {
			kana = "";
			pend = "";
			segs = null;
			focus = 0;
			genId++;
			eiji = false;
			resetAddl();
		};
		const backToYomi = () => {
			segs = null;
			focus = 0;
			genId++;
			resetAddl();
		};
		function addlAll() {
			if (!segs) return [];
			const key = segs[focus].key;
			const kata = toKatakana(key);
			const out = [];
			if (kata !== key) out.push({
				text: kata,
				annotation: "カタカナ"
			});
			out.push({
				text: key,
				annotation: "ひらがな"
			});
			return out;
		}
		function addlVisible() {
			const all = addlAll();
			const n = Math.min(addlShown, all.length);
			return n <= 0 ? [] : all.slice(all.length - n);
		}
		/** 文節 i の現在の出力テキスト（注目文節で追加候補を選択中ならそれを優先） */
		function segText(s, i) {
			if (i === focus && addlSel !== null) {
				const v = addlVisible();
				if (addlSel < v.length) return v[addlSel].text;
			}
			return s.candidates[s.idx];
		}
		/** 次候補（↓ / Space / SandS 単打 convert）。追加候補領域内なら下へ、末尾で通常候補の先頭へ戻る */
		function candNext() {
			if (!segs) return;
			if (addlSel !== null) {
				if (addlSel + 1 < addlVisible().length) addlSel++;
				else {
					addlSel = null;
					segs[focus].idx = 0;
				}
				render();
				return;
			}
			const s = segs[focus];
			s.idx = (s.idx + 1) % s.candidates.length;
			render();
		}
		/** 前候補（↑ / 内蔵経路の Shift+Space）。通常候補の先頭でさらに上 = 追加候補を段階展開 */
		function candPrev() {
			if (!segs) return;
			if (addlSel !== null) {
				if (addlSel > 0) addlSel--;
				else if (addlShown < addlAll().length) addlShown++;
				render();
				return;
			}
			const s = segs[focus];
			if (s.idx === 0 && addlAll().length > 0) {
				if (addlShown === 0) addlShown = 1;
				addlSel = addlVisible().length - 1;
				render();
				return;
			}
			s.idx = (s.idx + s.candidates.length - 1) % s.candidates.length;
			render();
		}
		function render() {
			if (segs) cb.show(segs.map((s, i) => ({
				text: segText(s, i),
				kind: i === focus ? "focus" : "other",
				candidates: s.candidates.slice(),
				candidateIndex: s.idx,
				...i === focus && addlShown > 0 ? {
					additional: addlVisible(),
					...addlSel !== null ? { additionalIndex: addlSel } : {}
				} : {}
			})));
			else if (composing()) cb.show([{
				text: kana + pend,
				kind: "yomi"
			}]);
			else cb.hide();
		}
		const joined = () => (segs ?? []).map((s, i) => segText(s, i)).join("");
		let lastCommit = null;
		function commit(text) {
			const learned = !!(segs && cb.learn && !eiji);
			if (learned && segs) try {
				cb.learn(segs.map((s, i) => ({
					key: s.key,
					value: segText(s, i)
				})));
			} catch {}
			lastCommit = segs ? {
				text,
				segs,
				focus,
				kana,
				learned
			} : null;
			clear();
			cb.commit(text);
		}
		async function reconvert(surface) {
			if (!active || !cb.reconvert || segs || composing()) return false;
			if (engine && engine.getState().isComposing) return false;
			if (!surface) return false;
			const gen = ++genId;
			let result = null;
			try {
				result = await Promise.resolve(cb.reconvert(surface));
			} catch {
				result = null;
			}
			if (gen !== genId || segs || composing()) return false;
			if (!result || !result.length) return false;
			segs = result.map(ingestSegment);
			kana = segs.map((s) => s.key).join("");
			focus = 0;
			resetAddl();
			render();
			return true;
		}
		function undoCommit() {
			if (!lastCommit || composing() || !cb.retract) return false;
			let removed = false;
			try {
				removed = cb.retract(lastCommit.text);
			} catch {
				removed = false;
			}
			if (!removed) return false;
			segs = lastCommit.segs;
			focus = lastCommit.focus;
			kana = lastCommit.kana;
			genId++;
			resetAddl();
			if (lastCommit.learned) try {
				cb.unlearn?.();
			} catch {}
			lastCommit = null;
			render();
			return true;
		}
		function ingestSegment(s) {
			const cands = s.candidates && s.candidates.length ? [...new Set(s.candidates)] : [s.key];
			return {
				key: s.key,
				candidates: cands,
				idx: 0
			};
		}
		function startConvert() {
			kana = resolveRomaji(kana, pend, true).kana;
			pend = "";
			render();
			const yomi = kana;
			const gen = ++genId;
			(eiji && /^[\x20-\x7e]+$/.test(yomi) ? Promise.resolve(cb.convert ? cb.convert(yomi) : null).then((r) => mergeEijiConvert(yomi, r), () => eijiVariants(yomi)) : Promise.resolve(cb.convert ? cb.convert(yomi) : null)).then((result) => {
				if (gen !== genId || !composing() || kana !== yomi) return;
				if (!result || !result.length) result = fallbackConvert(yomi);
				segs = result.map(ingestSegment);
				focus = 0;
				resetAddl();
				render();
			}).catch(() => {});
		}
		function startResize(offset) {
			if (!segs || !cb.resize) return;
			const idx = focus;
			const gen = ++genId;
			Promise.resolve(cb.resize(idx, offset)).then((result) => {
				if (gen !== genId || !segs) return;
				if (!result || !result.length) return;
				segs = result.map(ingestSegment);
				focus = Math.min(idx, segs.length - 1);
				resetAddl();
				render();
			}).catch(() => {});
		}
		let engine = null;
		let engineKeyOf = null;
		let commitYomiDirect = false;
		function pumpEngine() {
			if (!engine) return;
			if (segs) {
				const st = engine.getState();
				if (!st.isComposing && !st.confirmedText) return;
				commit(joined());
			}
			const confirmed = engine.takeConfirmedText();
			const direct = commitYomiDirect;
			commitYomiDirect = false;
			if (confirmed) {
				if (engine.getState().inputMode === "english") {
					cb.commit(confirmed);
					return;
				}
				if (direct) {
					commit(kana + confirmed);
					return;
				}
				kana += confirmed;
				pend = "";
				startConvert();
				return;
			}
			const st = engine.getState();
			if (st.isComposing) cb.show([{
				text: kana + st.composingKana + st.pendingDisplay,
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
				backToYomi();
				render();
				return true;
			}
			if (k === "ArrowLeft" || k === "ArrowRight") {
				if (tap.shiftKey) {
					if (cb.resize) startResize(k === "ArrowRight" ? 1 : -1);
					return true;
				}
				if (cur.length > 1) {
					focus = (focus + (k === "ArrowRight" ? 1 : cur.length - 1)) % cur.length;
					resetAddl();
				}
				render();
				return true;
			}
			if (k === "ArrowUp" || k === "ArrowDown") {
				if (k === "ArrowDown") candNext();
				else candPrev();
				return true;
			}
			return true;
		}
		function handleEngineAction(action) {
			const t = action.type;
			if (t === "editSegmentLeft" || t === "editSegmentRight") {
				if (segs && cb.resize) startResize(t === "editSegmentRight" ? 1 : -1);
				return true;
			}
			if (t === "convert" || t === "confirm" || t === "insertAndConfirm") {
				const yomiRestored = !segs && composing() && !(engine && engine.getState().isComposing);
				if (!segs && !yomiRestored) {
					if (t === "insertAndConfirm" || t === "confirm" && engine && engine.getState().isComposing) commitYomiDirect = true;
					return false;
				}
				if (t === "convert") {
					if (segs) candNext();
					else startConvert();
					return true;
				}
				commit(segs ? joined() : kana);
				if (action.type === "insertAndConfirm") cb.commit(action.text);
				return true;
			}
			if (t !== "moveLeft" && t !== "moveRight" && t !== "deleteBack") return false;
			if (segs) {
				if (t === "deleteBack") {
					backToYomi();
					render();
					return true;
				}
				if (segs.length > 1) {
					focus = (focus + (t === "moveRight" ? 1 : segs.length - 1)) % segs.length;
					resetAddl();
				}
				render();
				return true;
			}
			if (engine && engine.getState().isComposing) {
				if (t === "deleteBack") return false;
				return true;
			}
			if (composing()) {
				if (t === "deleteBack") {
					kana = Array.from(kana).slice(0, -1).join("");
					genId++;
					render();
					return true;
				}
				return true;
			}
			if (cb.hostKey) cb.hostKey(t === "deleteBack" ? "Backspace" : t === "moveRight" ? "ArrowRight" : "ArrowLeft");
			return true;
		}
		const PHASE2_NAV_KEYS = /* @__PURE__ */ new Set([
			"Enter",
			"Escape",
			"Backspace",
			"ArrowLeft",
			"ArrowRight",
			"ArrowUp",
			"ArrowDown"
		]);
		function engineDown(tap) {
			if (!engine) return false;
			if (segs) {
				if (tap.key === "Shift" || tap.key === "Control" || tap.key === "Alt" || tap.key === "Meta") return true;
				if (tap.ctrlKey || tap.altKey || tap.metaKey) {
					commit(joined());
					return false;
				}
				if (tap.repeat) return true;
				if (PHASE2_NAV_KEYS.has(tap.key)) return navCandidates(tap);
				const kev = engineKeyOf ? engineKeyOf(tap) : null;
				if (!kev) {
					commit(joined());
					return false;
				}
				engine.processKey(kev);
				pumpEngine();
				return true;
			}
			if (tap.key === "Backspace" && tap.ctrlKey && !tap.altKey && !tap.metaKey && !engine.getState().isComposing && !composing()) return undoCommit() ? true : false;
			if (tap.ctrlKey || tap.altKey || tap.metaKey) return false;
			if (tap.repeat) return true;
			const composingNow = engine.getState().isComposing;
			if (!composingNow && composing()) {
				const k = tap.key;
				if (k === "Backspace") {
					kana = Array.from(kana).slice(0, -1).join("");
					genId++;
					render();
					return true;
				}
				if (k === "Enter") {
					commit(kana);
					return true;
				}
				if (k === "Escape") {
					clear();
					cb.hide();
					return true;
				}
				if (k === "ArrowLeft" || k === "ArrowRight" || k === "ArrowUp" || k === "ArrowDown") return true;
			}
			if (!composingNow && tap.code !== void 0 && HOST_NAV_KEYS.has(tap.code)) return false;
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
			if (e.key === "Backspace" && e.ctrlKey && !e.altKey && !e.metaKey && !composing()) return undoCommit() ? true : false;
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
				if (!composing()) eiji = false;
				render();
				return true;
			}
			if (k === " ") {
				if (!composing()) return false;
				if (segs) if (e.shiftKey) candPrev();
				else candNext();
				else startConvert();
				return true;
			}
			if (k === "ArrowLeft" || k === "ArrowRight") {
				if (!composing()) return false;
				if (segs && e.shiftKey) {
					if (cb.resize) startResize(k === "ArrowRight" ? 1 : -1);
					return true;
				}
				if (segs && segs.length > 1) {
					focus = (focus + (k === "ArrowRight" ? 1 : segs.length - 1)) % segs.length;
					resetAddl();
					render();
				}
				return true;
			}
			if (k === "ArrowUp" || k === "ArrowDown") {
				if (!composing()) return false;
				if (segs) if (k === "ArrowDown") candNext();
				else candPrev();
				return true;
			}
			if (k.length === 1 && k >= " " && k <= "~") {
				if (/[a-zA-Z]/.test(k) && e.shiftKey) {
					if (segs) commit(joined());
					kana = resolveRomaji(kana, pend, true).kana + k;
					pend = "";
					eiji = true;
					genId++;
					render();
					return true;
				}
				if (eiji && !segs) {
					kana += k;
					genId++;
					render();
					return true;
				}
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
			selectCandidate(index) {
				if (!segs) return false;
				const s = segs[focus];
				if (!Number.isInteger(index) || index < 0 || index >= s.candidates.length) return false;
				addlSel = null;
				s.idx = index;
				render();
				return true;
			},
			undoCommit,
			reconvert,
			reset() {
				clear();
				if (engine) try {
					engine.reset();
				} catch {}
			}
		};
	}
	//#endregion
	//#region src/hechima/worker-client.ts
	function connectWorker(worker, opts) {
		const maxCands = opts?.maxCands ?? 9;
		const pending = /* @__PURE__ */ new Map();
		const pendingLearn = /* @__PURE__ */ new Map();
		const pendingDict = /* @__PURE__ */ new Map();
		let seq = 0;
		let ready = null;
		let initPromise = null;
		let resolveReady = null;
		let rejectReady = null;
		worker.addEventListener("message", (ev) => {
			const m = ev.data;
			if (!m || typeof m !== "object") return;
			if (m.type === "progress") opts?.onProgress?.(m.loaded, m.total);
			else if (m.type === "ready") {
				ready = {
					protocol: m.protocol,
					version: m.version,
					features: m.features
				};
				resolveReady?.(ready);
			} else if (m.type === "error") rejectReady?.(new Error(m.message));
			else if (m.type === "result") {
				const resolve = pending.get(m.id);
				if (resolve) {
					pending.delete(m.id);
					resolve(m.segments);
				}
			} else if (m.type === "learned") {
				const resolve = pendingLearn.get(m.id);
				if (resolve) {
					pendingLearn.delete(m.id);
					resolve(m.ok);
				}
			} else if (m.type === "dict") {
				const resolve = pendingDict.get(m.id);
				if (resolve) {
					pendingDict.delete(m.id);
					resolve(m.entries);
				}
			}
		});
		function init(paths) {
			if (!initPromise) initPromise = new Promise((resolve, reject) => {
				resolveReady = resolve;
				rejectReady = reject;
				worker.postMessage({
					type: "init",
					...paths
				});
			});
			return initPromise;
		}
		/** init 完了を待つ。init 未呼び出しなら既定パスで開始する。失敗は null 扱いにする */
		async function whenReady() {
			try {
				return await init();
			} catch {
				return null;
			}
		}
		async function convert(yomi) {
			if (!await whenReady()) return null;
			return new Promise((resolve) => {
				const id = ++seq;
				pending.set(id, resolve);
				worker.postMessage({
					type: "convert",
					id,
					kana: yomi,
					maxCands
				});
			});
		}
		async function resize(segmentIndex, offset) {
			const info = await whenReady();
			if (!info || !info.features.resize) return null;
			return new Promise((resolve) => {
				const id = ++seq;
				pending.set(id, resolve);
				worker.postMessage({
					type: "resize",
					id,
					segIdx: segmentIndex,
					offset,
					maxCands
				});
			});
		}
		async function learn(segments) {
			const info = await whenReady();
			if (!info || info.features.learn === false || !segments.length) return false;
			return new Promise((resolve) => {
				const id = ++seq;
				pendingLearn.set(id, resolve);
				worker.postMessage({
					type: "learn",
					id,
					kana: segments.map((s) => s.key).join(""),
					sizes: segments.map((s) => Array.from(s.key).length),
					values: segments.map((s) => s.value)
				});
			});
		}
		async function reconvert(surface) {
			if (!await whenReady()) return null;
			return new Promise((resolve) => {
				const id = ++seq;
				pending.set(id, resolve);
				worker.postMessage({
					type: "reconvert",
					id,
					surface,
					maxCands
				});
			});
		}
		async function revert() {
			if (!await whenReady()) return false;
			return new Promise((resolve) => {
				const id = ++seq;
				pendingLearn.set(id, resolve);
				worker.postMessage({
					type: "revert",
					id
				});
			});
		}
		function dictRequest(msg) {
			return whenReady().then((info) => {
				if (!info || info.features.dict === false) return null;
				return new Promise((resolve) => {
					const id = ++seq;
					pendingDict.set(id, resolve);
					worker.postMessage({
						...msg,
						id
					});
				});
			});
		}
		/** ユーザー辞書の一覧（v0.11.0+）。未対応は null */
		function dictList() {
			return dictRequest({ type: "dictList" });
		}
		/** ユーザー辞書へ登録（v0.11.0+。pos 省略 = 名詞）。成功 = 更新後の一覧、失敗 = null */
		function dictAdd(reading, word, pos = 1) {
			return dictRequest({
				type: "dictAdd",
				reading,
				word,
				pos
			});
		}
		/** ユーザー辞書から削除（一覧の index）。成功 = 更新後の一覧、失敗 = null */
		function dictRemove(index) {
			return dictRequest({
				type: "dictRemove",
				index
			});
		}
		async function clearLearning() {
			if (!await whenReady()) return false;
			return new Promise((resolve) => {
				const id = ++seq;
				pendingLearn.set(id, resolve);
				worker.postMessage({
					type: "clearLearning",
					id
				});
			});
		}
		return {
			init,
			convert,
			resize,
			reconvert,
			learn,
			revert,
			clearLearning,
			dictList,
			dictAdd,
			dictRemove,
			callbacks: () => ({
				convert,
				resize,
				reconvert,
				learn: (segments) => {
					learn(segments);
				},
				unlearn: () => {
					revert();
				}
			})
		};
	}
	//#endregion
	//#region src/hechima/protocol.ts
	/** 電文プロトコル版数。ready 応答の `protocol` で通知される */
	const HECHIMA_PROTOCOL_VERSION = 0;
	//#endregion
	//#region src/hechima/index.ts
	/** このバンドルのバージョン（取り込み側が記録する用） */
	const version = HECHIMA_VERSION;
	//#endregion
	exports.HECHIMA_PROTOCOL_VERSION = HECHIMA_PROTOCOL_VERSION;
	exports.connectWorker = connectWorker;
	exports.createFep = createFep;
	exports.fallbackConvert = fallbackConvert;
	exports.resolveRomaji = resolveRomaji;
	exports.version = version;
});
