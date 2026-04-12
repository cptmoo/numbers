const { createApp } = Vue;

createApp({
  data() {
    return {
      menuOpen: false,
      activeModeId: "daily-certain",
      timerSeconds: 30,
      timerId: null,
      target: 124,
      seedLabel: "",

      startTiles: [],
      startTileIdCounter: 0,

      lines: [],
      selectedItem: null, // { kind:'tile'|'op', source:'start'|'result'|'placed', tileId?, op?, fromLineIndex?, fromSlotKey? }

      bestValue: null,
      bestGap: null,

      message: "Select a number or operation",

      dragState: {
        active: false,
        payload: null,
      },

      modes: [
        { id: "daily-certain", title: "Daily", subtitle: "Certain game", type: "certain", daily: true, duration: 0 },
        { id: "daily-traditional", title: "Daily traditional", subtitle: "Closest wins", type: "traditional", daily: true, duration: 0 },
        { id: "certain-2", title: "2 min certain", subtitle: "Exact target", type: "certain", daily: false, duration: 120 },
        { id: "traditional-2", title: "2 min traditional", subtitle: "Closest wins", type: "traditional", daily: false, duration: 120 },
      ],

      ops: [
        { value: "+", label: "+" },
        { value: "-", label: "−" },
        { value: "*", label: "×" },
        { value: "/", label: "÷" },
      ],
    };
  },

  computed: {
    activeMode() {
      return this.modes.find((m) => m.id === this.activeModeId) || this.modes[0];
    },

    timeText() {
      const total = Math.max(0, this.timerSeconds || 0);
      const mins = Math.floor(total / 60);
      const secs = total % 60;
      return `${mins}:${String(secs).padStart(2, "0")}`;
    },

    restoreBestText() {
      return this.bestValue == null ? "Restore best" : `Restore ${this.bestValue}`;
    },

    liveCount() {
      let count = 0;
      for (const tile of this.startTiles) {
        if (!this.isStartTileUsed(tile.id)) count += 1;
      }
      for (let i = 0; i < this.lines.length; i += 1) {
        if (this.lineHasResult(i) && !this.isResultTileUsed(i)) count += 1;
      }
      return count;
    },

    nextLineIndex() {
      for (let i = 0; i < this.lines.length; i += 1) {
        const line = this.lines[i];
        if (!(line.aRef && line.op && line.bRef)) return i;
      }
      return this.lines.length - 1;
    },
  },

  mounted() {
    this.startMode(this.activeModeId);
    window.addEventListener("pointerup", this.onGlobalPointerUp);
    window.addEventListener("pointercancel", this.onGlobalPointerUp);
  },

  beforeUnmount() {
    this.stopTimer();
    window.removeEventListener("pointerup", this.onGlobalPointerUp);
    window.removeEventListener("pointercancel", this.onGlobalPointerUp);
  },

  methods: {
    startMode(modeId) {
      const mode = this.modes.find((m) => m.id === modeId) || this.modes[0];
      this.activeModeId = mode.id;
      this.menuOpen = false;
      this.newBoard();
    },

    newBoard() {
      this.stopTimer();
      this.selectedItem = null;
      this.bestValue = null;
      this.bestGap = null;
      this.dragState = { active: false, payload: null };

      const puzzle = this.generatePuzzle(this.activeMode);
      this.target = puzzle.target;
      this.seedLabel = puzzle.seedLabel;

      this.startTileIdCounter = 0;
      this.startTiles = puzzle.numbers.map((value) => ({
        id: this.makeStartTileId(),
        value,
      }));

      this.lines = Array.from({ length: 5 }, () => this.makeEmptyLine());

      if (this.activeMode.duration > 0) {
        this.timerSeconds = this.activeMode.duration;
        this.startTimer();
      } else {
        this.timerSeconds = 0;
      }

      this.message = "Select a number or operation";
    },

    makeEmptyLine() {
      return {
        aRef: null,
        op: null,
        bRef: null,
      };
    },

    startTimer() {
      this.stopTimer();
      this.timerId = setInterval(() => {
        if (this.timerSeconds <= 1) {
          this.timerSeconds = 0;
          this.stopTimer();
          this.message = "Time";
          return;
        }
        this.timerSeconds -= 1;
      }, 1000);
    },

    stopTimer() {
      if (this.timerId) {
        clearInterval(this.timerId);
        this.timerId = null;
      }
    },

    makeStartTileId() {
      this.startTileIdCounter += 1;
      return `start-${this.startTileIdCounter}`;
    },

    resultTileIdForLine(lineIndex) {
      return `result-${lineIndex}`;
    },

    resultLineIndexFromId(tileId) {
      return Number(String(tileId).replace("result-", ""));
    },

    sameTileRef(a, b) {
      if (!a || !b) return false;
      return a.source === b.source && a.id === b.id;
    },

    getStartTileById(tileId) {
      return this.startTiles.find((t) => t.id === tileId) || null;
    },

    getTileValueFromRef(ref) {
      if (!ref) return null;

      if (ref.source === "start") {
        const tile = this.getStartTileById(ref.id);
        return tile ? tile.value : null;
      }

      if (ref.source === "result") {
        const lineIndex = this.resultLineIndexFromId(ref.id);
        const result = this.lineComputedResult(lineIndex);
        return result.valid ? result.value : null;
      }

      return null;
    },

    refUsedInLine(ref, ignoreLineIndex = null, ignoreSlotKey = null) {
      for (let i = 0; i < this.lines.length; i += 1) {
        if (!(ignoreLineIndex === i && ignoreSlotKey === "aRef") && this.sameTileRef(this.lines[i].aRef, ref)) return true;
        if (!(ignoreLineIndex === i && ignoreSlotKey === "bRef") && this.sameTileRef(this.lines[i].bRef, ref)) return true;
      }
      return false;
    },

    isStartTileUsed(tileId) {
      return this.refUsedInLine({ source: "start", id: tileId });
    },

    isResultTileUsed(lineIndex) {
      return this.refUsedInLine({ source: "result", id: this.resultTileIdForLine(lineIndex) });
    },

    lineDisplayValue(lineIndex, slotKey) {
      const ref = this.lines[lineIndex][slotKey];
      const value = this.getTileValueFromRef(ref);
      return value == null ? "" : value;
    },

    lineDisplayClass(lineIndex, slotKey) {
      const ref = this.lines[lineIndex][slotKey];
      if (!ref) return "";
      return ref.source === "result" ? "is-derived" : "is-original";
    },

    lineHasResult(lineIndex) {
      const line = this.lines[lineIndex];
      return line.aRef != null && line.op != null && line.bRef != null;
    },

    lineComputedResult(lineIndex) {
      const line = this.lines[lineIndex];
      const a = this.getTileValueFromRef(line.aRef);
      const b = this.getTileValueFromRef(line.bRef);

      if (line.aRef == null || line.op == null || line.bRef == null) {
        return { valid: false, ready: false, value: null };
      }

      if (a == null || b == null) {
        return { valid: false, ready: true, value: null };
      }

      return this.calculate(a, line.op, b);
    },

    resultPreviewValue(lineIndex) {
      const result = this.lineComputedResult(lineIndex);
      return result.valid ? result.value : "";
    },

    resultIsInvalid(lineIndex) {
      const result = this.lineComputedResult(lineIndex);
      return result.ready && !result.valid;
    },

    isNextLine(lineIndex) {
      return lineIndex === this.nextLineIndex;
    },

    makeTileRefFromSelection(sel = this.selectedItem) {
      if (!sel || sel.kind !== "tile") return null;

      if (sel.source === "start") {
        return { source: "start", id: sel.tileId };
      }

      if (sel.source === "result") {
        return { source: "result", id: sel.tileId };
      }

      if (sel.source === "placed") {
        return this.lines[sel.fromLineIndex]?.[sel.fromSlotKey] || null;
      }

      return null;
    },

    clearOriginIfPlaced(sel = this.selectedItem) {
      if (!sel || sel.kind !== "tile") return;
      if (sel.source === "placed") {
        this.lines[sel.fromLineIndex][sel.fromSlotKey] = null;
      }
      if (sel.source === "placed_op") {
        this.lines[sel.fromLineIndex].op = null;
      }
    },

    isSelectedStartTile(tileId) {
      return this.selectedItem?.kind === "tile" &&
        this.selectedItem?.source === "start" &&
        this.selectedItem?.tileId === tileId;
    },

    isSelectedResultTile(lineIndex) {
      return this.selectedItem?.kind === "tile" &&
        this.selectedItem?.source === "result" &&
        this.selectedItem?.tileId === this.resultTileIdForLine(lineIndex);
    },

    isSelectedPlacedTile(lineIndex, slotKey) {
      return this.selectedItem?.kind === "tile" &&
        this.selectedItem?.source === "placed" &&
        this.selectedItem?.fromLineIndex === lineIndex &&
        this.selectedItem?.fromSlotKey === slotKey;
    },

    isSelectedOp(opValue) {
      return this.selectedItem?.kind === "op" && this.selectedItem?.op === opValue;
    },

    isSelectedPlacedOp(lineIndex) {
      return this.selectedItem?.kind === "op" &&
        this.selectedItem?.source === "placed_op" &&
        this.selectedItem?.fromLineIndex === lineIndex;
    },

    selectStartTile(tileId) {
      if (this.isSelectedStartTile(tileId)) {
        this.selectedItem = null;
        this.message = "Select a number or operation";
        return;
      }
      if (this.isStartTileUsed(tileId)) return;
      this.selectedItem = { kind: "tile", source: "start", tileId };
      this.message = "Select a blue space";
    },

    selectResultTile(lineIndex) {
      if (!this.lineHasResult(lineIndex)) return;
      if (this.isSelectedResultTile(lineIndex)) {
        this.selectedItem = null;
        this.message = "Select a number or operation";
        return;
      }
      if (this.isResultTileUsed(lineIndex)) return;
      this.selectedItem = { kind: "tile", source: "result", tileId: this.resultTileIdForLine(lineIndex) };
      this.message = "Select a blue space";
    },

    selectPlacedTile(lineIndex, slotKey) {
      const ref = this.lines[lineIndex][slotKey];
      if (!ref) return;

      if (this.isSelectedPlacedTile(lineIndex, slotKey)) {
        this.selectedItem = null;
        this.message = "Select a number or operation";
        return;
      }

      this.selectedItem = {
        kind: "tile",
        source: "placed",
        fromLineIndex: lineIndex,
        fromSlotKey: slotKey,
      };
      this.message = "Select a blue space or top bank";
    },

    selectOp(opValue) {
      if (this.isSelectedOp(opValue)) {
        this.selectedItem = null;
        this.message = "Select a number or operation";
        return;
      }
      this.selectedItem = { kind: "op", op: opValue };
      this.message = "Select a blue space";
    },

    selectPlacedOp(lineIndex) {
      if (!this.lines[lineIndex].op) return;

      if (this.isSelectedPlacedOp(lineIndex)) {
        this.selectedItem = null;
        this.message = "Select a number or operation";
        return;
      }

      this.selectedItem = {
        kind: "op",
        source: "placed_op",
        fromLineIndex: lineIndex,
        op: this.lines[lineIndex].op,
      };
      this.message = "Select a blue space";
    },

    slotCanAccept(lineIndex, slotKey) {
      if (!this.selectedItem || this.selectedItem.kind !== "tile") return false;
      if (!(slotKey === "aRef" || slotKey === "bRef")) return false;

      const line = this.lines[lineIndex];
      const targetFilled = line[slotKey] != null;

      if (this.selectedItem.source === "start") {
        return this.isNextLine(lineIndex) || targetFilled;
      }

      if (this.selectedItem.source === "result") {
        const sourceLine = this.resultLineIndexFromId(this.selectedItem.tileId);
        return this.isNextLine(lineIndex) || (lineIndex > sourceLine && targetFilled);
      }

      if (this.selectedItem.source === "placed") {
        if (this.selectedItem.fromLineIndex === lineIndex && this.selectedItem.fromSlotKey === slotKey) return false;

        const movingRef = this.makeTileRefFromSelection(this.selectedItem);
        if (!movingRef) return false;

        if (movingRef.source === "start") {
          return this.isNextLine(lineIndex) || targetFilled;
        }

        if (movingRef.source === "result") {
          const sourceLine = this.resultLineIndexFromId(movingRef.id);
          return this.isNextLine(lineIndex) || (lineIndex > sourceLine && targetFilled);
        }
      }

      return false;
    },

    opSlotCanAccept(lineIndex) {
      if (!this.selectedItem || this.selectedItem.kind !== "op") return false;

      if (this.selectedItem.source === "placed_op") {
        if (this.selectedItem.fromLineIndex === lineIndex) return false;
      }

      const line = this.lines[lineIndex];
      return this.isNextLine(lineIndex) || line.op != null;
    },

    bankCanAcceptPlacedTile(tileId) {
      if (!this.selectedItem || this.selectedItem.kind !== "tile") return false;
      if (this.selectedItem.source !== "placed") return false;

      const movingRef = this.makeTileRefFromSelection(this.selectedItem);
      return movingRef?.source === "start" && movingRef.id === tileId;
    },

    placeIntoTileSlot(lineIndex, slotKey) {
      if (!this.slotCanAccept(lineIndex, slotKey)) return;

      const incomingRef = this.makeTileRefFromSelection(this.selectedItem);
      if (!incomingRef) return;

      const replaced = this.lines[lineIndex][slotKey];
      this.clearOriginIfPlaced(this.selectedItem);
      this.lines[lineIndex][slotKey] = incomingRef;

      if (this.selectedItem?.source === "placed" && replaced) {
        this.lines[this.selectedItem.fromLineIndex][this.selectedItem.fromSlotKey] = replaced;
      }

      this.selectedItem = null;
      this.refreshBest();
      this.message = "Select a number or operation";
    },

    placeIntoOpSlot(lineIndex) {
      if (!this.opSlotCanAccept(lineIndex)) return;

      const incomingOp = this.selectedItem.op;
      const replaced = this.lines[lineIndex].op;

      this.clearOriginIfPlaced(this.selectedItem);
      this.lines[lineIndex].op = incomingOp;

      if (this.selectedItem?.source === "placed_op" && replaced) {
        this.lines[this.selectedItem.fromLineIndex].op = replaced;
      }

      this.selectedItem = null;
      this.refreshBest();
      this.message = "Select a number or operation";
    },

    returnPlacedTileToBank(tileId) {
      if (!this.bankCanAcceptPlacedTile(tileId)) return;
      this.clearOriginIfPlaced(this.selectedItem);
      this.selectedItem = null;
      this.refreshBest();
      this.message = "Returned to top";
    },

    clearAllWorking() {
      this.selectedItem = null;
      this.lines = Array.from({ length: 5 }, () => this.makeEmptyLine());
      this.bestValue = null;
      this.bestGap = null;
      this.message = "Select a number or operation";
    },

    restoreBest() {
      if (this.bestValue == null) return;

      for (const tile of this.startTiles) {
        if (tile.value === this.bestValue && !this.isStartTileUsed(tile.id)) {
          this.selectedItem = { kind: "tile", source: "start", tileId: tile.id };
          this.message = "Select a blue space";
          return;
        }
      }

      for (let i = 0; i < this.lines.length; i += 1) {
        const result = this.lineComputedResult(i);
        if (this.lineHasResult(i) && result.valid && result.value === this.bestValue && !this.isResultTileUsed(i)) {
          this.selectedItem = { kind: "tile", source: "result", tileId: this.resultTileIdForLine(i) };
          this.message = "Select a blue space";
          return;
        }
      }
    },

    refreshBest() {
      this.bestValue = null;
      this.bestGap = null;
      for (let i = 0; i < this.lines.length; i += 1) {
        const result = this.lineComputedResult(i);
        if (result.valid) this.updateBest(result.value);
      }
    },

    updateBest(value) {
      const gap = Math.abs(this.target - value);
      if (this.bestGap == null || gap < this.bestGap) {
        this.bestGap = gap;
        this.bestValue = value;
      }
    },

    calculate(a, op, b) {
      if (op === "+") return { valid: true, ready: true, value: a + b };
      if (op === "*") return { valid: true, ready: true, value: a * b };
      if (op === "-") {
        if (a <= b) return { valid: false, ready: true, value: null };
        return { valid: true, ready: true, value: a - b };
      }
      if (op === "/") {
        if (b === 0) return { valid: false, ready: true, value: null };
        if (a % b !== 0) return { valid: false, ready: true, value: null };
        return { valid: true, ready: true, value: a / b };
      }
      return { valid: false, ready: false, value: null };
    },

    onDragStartTile(tileId) {
      if (this.isStartTileUsed(tileId)) return;
      this.selectedItem = { kind: "tile", source: "start", tileId };
      this.dragState = { active: true, payload: this.selectedItem };
    },

    onDragStartResult(lineIndex) {
      if (!this.lineHasResult(lineIndex) || this.isResultTileUsed(lineIndex)) return;
      this.selectedItem = { kind: "tile", source: "result", tileId: this.resultTileIdForLine(lineIndex) };
      this.dragState = { active: true, payload: this.selectedItem };
    },

    onDragStartPlacedTile(lineIndex, slotKey) {
      const ref = this.lines[lineIndex][slotKey];
      if (!ref) return;
      this.selectedItem = { kind: "tile", source: "placed", fromLineIndex: lineIndex, fromSlotKey: slotKey };
      this.dragState = { active: true, payload: this.selectedItem };
    },

    onDragStartOp(opValue) {
      this.selectedItem = { kind: "op", op: opValue };
      this.dragState = { active: true, payload: this.selectedItem };
    },

    onDragStartPlacedOp(lineIndex) {
      if (!this.lines[lineIndex].op) return;
      this.selectedItem = { kind: "op", source: "placed_op", fromLineIndex: lineIndex, op: this.lines[lineIndex].op };
      this.dragState = { active: true, payload: this.selectedItem };
    },

    onGlobalPointerUp() {
      this.dragState = { active: false, payload: null };
    },

    generatePuzzle(mode) {
      const now = new Date();
      const slot = mode.daily ? this.localDateStamp(now) : this.utcSlotStamp(now, mode.duration || 120);
      const seedString = `numbers|${mode.id}|${slot}`;
      const rand = this.mulberry32(this.fnv1a32(seedString));

      const large = [25, 50, 75, 100];
      const small = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const largeCount = rand() < 0.5 ? 1 : 2;

      const nums = [];
      const largeBag = [...large];
      const smallBag = [...small, ...small];

      for (let i = 0; i < largeCount; i += 1) {
        const pick = Math.floor(rand() * largeBag.length);
        nums.push(largeBag.splice(pick, 1)[0]);
      }

      while (nums.length < 6) {
        const pick = Math.floor(rand() * smallBag.length);
        nums.push(smallBag.splice(pick, 1)[0]);
      }

      this.shuffle(nums, rand);

      return {
        numbers: nums,
        target: 100 + Math.floor(rand() * 900),
        seedLabel: slot,
      };
    },

    localDateStamp(date) {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, "0");
      const d = String(date.getDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    },

    utcSlotStamp(date, durationSeconds) {
      const minsPerSlot = Math.max(1, Math.floor(durationSeconds / 60));
      const y = date.getUTCFullYear();
      const m = String(date.getUTCMonth() + 1).padStart(2, "0");
      const d = String(date.getUTCDate()).padStart(2, "0");
      const hh = String(date.getUTCHours()).padStart(2, "0");
      const mm = String(Math.floor(date.getUTCMinutes() / minsPerSlot) * minsPerSlot).padStart(2, "0");
      return `${y}-${m}-${d} ${hh}:${mm}Z`;
    },

    fnv1a32(str) {
      let h = 0x811c9dc5;
      for (let i = 0; i < str.length; i += 1) {
        h ^= str.charCodeAt(i);
        h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
      }
      return h >>> 0;
    },

    mulberry32(seed) {
      let a = seed >>> 0;
      return function () {
        a |= 0;
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    },

    shuffle(arr, rand) {
      for (let i = arr.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rand() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
    },
  },

  template: `
    <main class="numbers-app">
      <div class="numbers-shell">
        <section class="numbers-top">
          <div class="numbers-top-row">
            <button class="numbers-menu" type="button" @click="menuOpen = true" aria-label="Menu">
              <span class="numbers-burger" aria-hidden="true">
                <span></span><span></span><span></span>
              </span>
            </button>

            <div class="numbers-brand">
              <div class="numbers-title">Numbers</div>
              <div class="numbers-sub">{{ activeMode.title }} · {{ seedLabel }}</div>
            </div>

            <div class="numbers-pill">
              <div class="numbers-pill-label">Time</div>
              <div class="numbers-pill-value">{{ timeText }}</div>
            </div>

            <div class="numbers-pill">
              <div class="numbers-pill-label">Best</div>
              <div class="numbers-pill-value">{{ bestValue == null ? "—" : bestValue }}</div>
            </div>
          </div>
        </section>

        <section class="numbers-board">
          <div class="numbers-status">
            <div class="numbers-target">
              <div class="numbers-label">Target</div>
              <div class="numbers-target-value">{{ target }}</div>
            </div>

            <div class="numbers-message">
              <div class="numbers-label">Now</div>
              <div class="numbers-message-text">{{ message }}</div>
            </div>
          </div>

          <div class="numbers-bank">
            <div class="numbers-bank-head">
              <div class="numbers-label">Numbers</div>
              <div class="numbers-label">{{ liveCount }} live</div>
            </div>

            <div class="numbers-bank-grid">
              <button
                v-for="tile in startTiles"
                :key="tile.id"
                class="numbers-tile"
                :class="{
                  'is-used': isStartTileUsed(tile.id),
                  'is-selected': isSelectedStartTile(tile.id),
                  'is-valid-drop': bankCanAcceptPlacedTile(tile.id),
                  'is-original': true
                }"
                type="button"
                @click="bankCanAcceptPlacedTile(tile.id) ? returnPlacedTileToBank(tile.id) : selectStartTile(tile.id)"
                @pointerdown="onDragStartTile(tile.id)"
              >
                <div class="numbers-tile-value">{{ tile.value }}</div>
              </button>
            </div>
          </div>

          <div class="numbers-work-area">
            <div class="numbers-lines">
              <div
                v-for="(line, lineIndex) in lines"
                :key="lineIndex"
                class="numbers-line"
              >
                <button
                  class="numbers-slot-button"
                  :class="[
                    lineDisplayClass(lineIndex, 'aRef'),
                    {
                      'is-empty': lineDisplayValue(lineIndex, 'aRef') === '',
                      'is-filled': lineDisplayValue(lineIndex, 'aRef') !== '',
                      'is-valid-drop': slotCanAccept(lineIndex, 'aRef'),
                      'is-selected': isSelectedPlacedTile(lineIndex, 'aRef')
                    }
                  ]"
                  type="button"
                  @click="line.aRef ? selectPlacedTile(lineIndex, 'aRef') : placeIntoTileSlot(lineIndex, 'aRef')"
                  @pointerup="slotCanAccept(lineIndex, 'aRef') ? placeIntoTileSlot(lineIndex, 'aRef') : null"
                  @pointerdown="line.aRef ? onDragStartPlacedTile(lineIndex, 'aRef') : null"
                >
                  <span v-if="lineDisplayValue(lineIndex, 'aRef') !== ''" class="numbers-slot-big">
                    {{ lineDisplayValue(lineIndex, 'aRef') }}
                  </span>
                </button>

                <button
                  class="numbers-op-slot"
                  :class="{
                    'is-empty': !line.op,
                    'is-filled': !!line.op,
                    'is-valid-drop': opSlotCanAccept(lineIndex),
                    'is-selected': isSelectedPlacedOp(lineIndex)
                  }"
                  type="button"
                  @click="line.op ? selectPlacedOp(lineIndex) : placeIntoOpSlot(lineIndex)"
                  @pointerup="opSlotCanAccept(lineIndex) ? placeIntoOpSlot(lineIndex) : null"
                  @pointerdown="line.op ? onDragStartPlacedOp(lineIndex) : null"
                >
                  <span v-if="line.op" class="numbers-op-big">
                    {{ line.op === '*' ? '×' : line.op === '/' ? '÷' : line.op === '-' ? '−' : '+' }}
                  </span>
                </button>

                <button
                  class="numbers-slot-button"
                  :class="[
                    lineDisplayClass(lineIndex, 'bRef'),
                    {
                      'is-empty': lineDisplayValue(lineIndex, 'bRef') === '',
                      'is-filled': lineDisplayValue(lineIndex, 'bRef') !== '',
                      'is-valid-drop': slotCanAccept(lineIndex, 'bRef'),
                      'is-selected': isSelectedPlacedTile(lineIndex, 'bRef')
                    }
                  ]"
                  type="button"
                  @click="line.bRef ? selectPlacedTile(lineIndex, 'bRef') : placeIntoTileSlot(lineIndex, 'bRef')"
                  @pointerup="slotCanAccept(lineIndex, 'bRef') ? placeIntoTileSlot(lineIndex, 'bRef') : null"
                  @pointerdown="line.bRef ? onDragStartPlacedTile(lineIndex, 'bRef') : null"
                >
                  <span v-if="lineDisplayValue(lineIndex, 'bRef') !== ''" class="numbers-slot-big">
                    {{ lineDisplayValue(lineIndex, 'bRef') }}
                  </span>
                </button>

                <div class="numbers-equals">=</div>

                <button
                  class="numbers-slot-button is-result"
                  :class="{
                    'is-empty': !lineHasResult(lineIndex),
                    'is-filled': lineHasResult(lineIndex),
                    'is-used': lineHasResult(lineIndex) && isResultTileUsed(lineIndex),
                    'is-selected': isSelectedResultTile(lineIndex),
                    'is-derived': lineHasResult(lineIndex),
                    'is-invalid': resultIsInvalid(lineIndex)
                  }"
                  type="button"
                  @click="selectResultTile(lineIndex)"
                  @pointerdown="lineHasResult(lineIndex) ? onDragStartResult(lineIndex) : null"
                >
                  <span v-if="lineComputedResult(lineIndex).valid" class="numbers-slot-big">
                    {{ lineComputedResult(lineIndex).value }}
                  </span>
                </button>
              </div>
            </div>

            <div class="numbers-ops-column">
              <button
                v-for="op in ops"
                :key="op.value"
                class="numbers-op-button"
                :class="{ 'is-selected': isSelectedOp(op.value) }"
                type="button"
                @click="selectOp(op.value)"
                @pointerdown="onDragStartOp(op.value)"
              >
                <span>{{ op.label }}</span>
              </button>
            </div>
          </div>

          <div class="numbers-bottom">
            <button type="button" @click="clearAllWorking">
              Clear
            </button>
            <button type="button" @click="restoreBest" :disabled="bestValue == null">
              {{ restoreBestText }}
            </button>
          </div>
        </section>
      </div>

      <div v-if="menuOpen" class="numbers-drawer-backdrop" @click="menuOpen = false"></div>

      <aside v-if="menuOpen" class="numbers-drawer">
        <div class="numbers-drawer-head">
          <div class="numbers-drawer-title">Menu</div>
          <button class="numbers-close" type="button" @click="menuOpen = false">×</button>
        </div>

        <button
          v-for="mode in modes"
          :key="mode.id"
          class="numbers-drawer-item"
          :class="{ 'is-active': mode.id === activeModeId }"
          type="button"
          @click="startMode(mode.id)"
        >
          <div class="numbers-drawer-item-title">{{ mode.title }}</div>
          <div class="numbers-drawer-item-sub">{{ mode.subtitle }}</div>
        </button>

        <div class="numbers-help">
          Tap to select/unselect. Drag to move.
        </div>
      </aside>
    </main>
  `,
}).mount("#app");