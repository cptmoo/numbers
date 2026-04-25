const { createApp } = Vue;

createApp({
  data() {
    return {
      activeModeId: "daily",
      timerSeconds: 0,
      timerId: null,
      target: 124,
      seedLabel: "",
      gameState: "pregame", // 'pregame' | 'playing' | 'finished'
      timeToSolve: null,
      startTiles: [],
      startTileIdCounter: 0,
      lines: [],
      selectedItem: null,

      bestValue: null,
      bestGap: null,
      bestSnapshot: null,

      solutionText: null,   // formatted text from findBestSolution()
      showSolution: false,  // toggles the solution panel

      message: "Pick a mode to start",

      dragState: {
        active: false,
        pointerId: null,
        startX: 0,
        startY: 0,
        payload: null,
      },
      suppressClickUntil: 0,

      modes: [
        { id: "daily", title: "Daily", type: "daily", duration: 6 },
        { id: "family", title: "5 min Family", type: "family", duration: 6 },
        { id: "class", title: "5 min Class", type: "class", duration: 6 },
        { id: "weird", title: "5 min Weird", type: "weird", duration: 6 },
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

    restoreBestText() {
      return this.bestValue == null ? "Restore" : `Restore ${this.bestValue}`;
    },

    finishedMessage() {
      if (this.gameState !== "finished") return "";
      if (this.bestGap === 0 && this.timeToSolve != null) {
        return `Solved in ${this.formatTime(this.timeToSolve)}!`;
      }
      if (this.bestGap != null) {
        return `Finished · ${this.bestGap} away`;
      }
      return "Time's up!";
    },

    canCopy() {
      return this.gameState === "finished";
    },
  },

  mounted() {
    this.selectMode(this.activeModeId);
    window.addEventListener("pointermove", this.onGlobalPointerMove);
    window.addEventListener("pointerup", this.onGlobalPointerUp);
    window.addEventListener("pointercancel", this.onGlobalPointerCancel);
  },

  beforeUnmount() {
    this.stopTimer();
    window.removeEventListener("pointermove", this.onGlobalPointerMove);
    window.removeEventListener("pointerup", this.onGlobalPointerUp);
    window.removeEventListener("pointercancel", this.onGlobalPointerCancel);
  },

  methods: {
    // ─── Game state management ────────────────────────────────────────
    selectMode(modeId) {
      this.activeModeId = modeId;
      this.gameState = "pregame";
      this.stopTimer();
      this.timerSeconds = 0;
      this.target = 0;
      this.seedLabel = "";
      this.startTiles = [];
      this.lines = Array.from({ length: 5 }, () => this.makeEmptyLine());
      this.selectedItem = null;
      this.bestValue = null;
      this.bestGap = null;
      this.bestSnapshot = null;
      this.solutionText = null;
      this.showSolution = false;
      this.message = "Pick a mode to start";
      this.dragState = { active: false, pointerId: null, startX: 0, startY: 0, payload: null };
    },

    startMode(modeId) {
      this.activeModeId = modeId;
      this.gameState = "playing";
      this.newBoard();
    },

    newBoard() {
      this.stopTimer();
      this.selectedItem = null;
      this.bestValue = null;
      this.bestGap = null;
      this.bestSnapshot = null;
      this.solutionText = null;
      this.showSolution = false;
      this.timeToSolve = null;
      this.dragState = { active: false, pointerId: null, startX: 0, startY: 0, payload: null };

      const puzzle = this.generatePuzzle(this.activeMode);
      this.target = puzzle.target;
      this.seedLabel = puzzle.seedLabel;

      this.startTileIdCounter = 0;
      this.startTiles = puzzle.numbers.map((value) => ({ id: this.makeStartTileId(), value }));
      this.lines = Array.from({ length: 5 }, () => this.makeEmptyLine());

      if (this.activeMode.duration > 0 && this.gameState === "playing") {
        this.timerSeconds = this.activeMode.duration;
        this.startTimer();
      } else {
        this.timerSeconds = 0;
      }

      this.message = "Select a number or operation";
    },

    // ─── End-game actions ─────────────────────────────────────────────
    copyResult() {
      if (this.gameState !== "finished") return;
      const mode = this.activeMode.title;
      const seed = this.seedLabel;
      let resultText = "";
      if (this.bestGap === 0 && this.timeToSolve != null) {
        resultText = `Solved in ${this.formatTime(this.timeToSolve)}`;
      } else if (this.bestGap != null) {
        resultText = `Off by ${this.bestGap}`;
      } else {
        resultText = "No solution found";
      }
      const text = `Numbers ${mode}\n${seed}\nTarget: ${this.target}\n${resultText}`;
      navigator.clipboard.writeText(text).then(() => { this.message = "Copied!"; });
    },

    showComputerSolution() {
      if (this.gameState !== "finished") return;

      // If already computed, just toggle visibility
      if (this.solutionText) {
        this.showSolution = !this.showSolution;
        if (this.showSolution) {
          this.$nextTick(() => {
            document.getElementById("solution-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
          });
        }
        return;
      }

      // Compute and show
      this.solutionText = this.findBestSolution(this.startTiles.map((t) => t.value), this.target);
      this.showSolution = true;
      this.$nextTick(() => {
        document.getElementById("solution-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    },

    // ─── PLACEHOLDER: solver ─────────────────────────────────────────
    // TODO: implement a full recursive search over all permutations of
    // the 6 numbers and 4 operations (including intermediate results),
    // pruning invalid steps (negative results, non-integer division),
    // and return the step-by-step working that reaches or comes closest
    // to the target.
    findBestSolution(numbers, target) {
      return (
        `🔧 Solver not yet implemented.\n\n` +
        `Numbers available: ${numbers.join(", ")}\n` +
        `Target: ${target}\n\n` +
        `When implemented, the step-by-step solution will appear here.`
      );
    },

    // ─── Utility ──────────────────────────────────────────────────────
    formatTime(seconds) {
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      return `${mins}:${String(secs).padStart(2, "0")}`;
    },

    makeEmptyLine() {
      return { aRef: null, op: null, bRef: null };
    },

    startTimer() {
      this.stopTimer();
      this.timerId = setInterval(() => {
        if (this.timerSeconds <= 1) {
          this.timerSeconds = 0;
          this.stopTimer();
          this.gameState = "finished";
          return;
        }
        this.timerSeconds -= 1;
      }, 1000);
    },

    stopTimer() {
      if (this.timerId) { clearInterval(this.timerId); this.timerId = null; }
    },

    derivedLabel(lineIndex) {
      return String.fromCharCode(65 + lineIndex);
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

    currentSelection() {
      return this.dragState.active && this.dragState.payload
        ? this.dragState.payload
        : this.selectedItem;
    },

    shouldIgnoreClick() {
      return Date.now() < this.suppressClickUntil;
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

    lineDependsOnLine(checkLineIndex, targetLineIndex, visited = new Set()) {
      if (checkLineIndex === targetLineIndex) return true;
      if (visited.has(checkLineIndex)) return false;
      visited.add(checkLineIndex);
      const line = this.lines[checkLineIndex];
      if (!line) return false;
      for (const ref of [line.aRef, line.bRef]) {
        if (ref?.source === "result") {
          const depLineIndex = this.resultLineIndexFromId(ref.id);
          if (depLineIndex === targetLineIndex) return true;
          if (this.lineDependsOnLine(depLineIndex, targetLineIndex, visited)) return true;
        }
      }
      return false;
    },

    wouldCreateCircularReference(incomingRef, targetLineIndex) {
      if (!incomingRef || incomingRef.source !== "result") return false;
      return this.lineDependsOnLine(this.resultLineIndexFromId(incomingRef.id), targetLineIndex);
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
      if (line.aRef == null || line.op == null || line.bRef == null) return { valid: false, ready: false, value: null };
      if (a == null || b == null) return { valid: false, ready: true, value: null };
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
      if (sel.source === "start") return { source: "start", id: sel.tileId };
      if (sel.source === "result") return { source: "result", id: sel.tileId };
      if (sel.source === "placed") return this.lines[sel.fromLineIndex]?.[sel.fromSlotKey] || null;
      return null;
    },

    clearOriginIfPlaced(sel = this.selectedItem) {
      if (!sel) return;
      if (sel.kind === "tile" && sel.source === "placed") this.lines[sel.fromLineIndex][sel.fromSlotKey] = null;
      if (sel.kind === "op" && sel.source === "placed_op") this.lines[sel.fromLineIndex].op = null;
    },

    isSelectedStartTile(tileId) {
      return this.selectedItem?.kind === "tile" && this.selectedItem?.source === "start" && this.selectedItem?.tileId === tileId;
    },

    isSelectedResultTile(lineIndex) {
      return this.selectedItem?.kind === "tile" && this.selectedItem?.source === "result" && this.selectedItem?.tileId === this.resultTileIdForLine(lineIndex);
    },

    isSelectedPlacedTile(lineIndex, slotKey) {
      return this.selectedItem?.kind === "tile" && this.selectedItem?.source === "placed" && this.selectedItem?.fromLineIndex === lineIndex && this.selectedItem?.fromSlotKey === slotKey;
    },

    isSelectedOp(opValue) {
      return this.selectedItem?.kind === "op" && this.selectedItem?.op === opValue;
    },

    isSelectedPlacedOp(lineIndex) {
      return this.selectedItem?.kind === "op" && this.selectedItem?.source === "placed_op" && this.selectedItem?.fromLineIndex === lineIndex;
    },

    selectStartTile(tileId) {
      if (this.gameState !== "playing") return;
      if (this.shouldIgnoreClick()) return;
      if (this.isSelectedStartTile(tileId)) { this.selectedItem = null; this.message = "Select a number or operation"; return; }
      if (this.isStartTileUsed(tileId)) return;
      this.selectedItem = { kind: "tile", source: "start", tileId };
      this.message = "Select a blue space";
    },

    selectResultTile(lineIndex) {
      if (this.gameState !== "playing") return;
      if (this.shouldIgnoreClick()) return;
      if (!this.lineHasResult(lineIndex)) return;
      if (this.isSelectedResultTile(lineIndex)) { this.selectedItem = null; this.message = "Select a number or operation"; return; }
      if (this.isResultTileUsed(lineIndex)) return;
      this.selectedItem = { kind: "tile", source: "result", tileId: this.resultTileIdForLine(lineIndex) };
      this.message = "Select a blue space";
    },

    selectPlacedTile(lineIndex, slotKey) {
      if (this.gameState !== "playing") return;
      if (this.shouldIgnoreClick()) return;
      const ref = this.lines[lineIndex][slotKey];
      if (!ref) return;
      if (this.isSelectedPlacedTile(lineIndex, slotKey)) { this.selectedItem = null; this.message = "Select a number or operation"; return; }
      this.selectedItem = { kind: "tile", source: "placed", fromLineIndex: lineIndex, fromSlotKey: slotKey };
      this.message = "Select a blue space or top bank";
    },

    selectOp(opValue) {
      if (this.gameState !== "playing") return;
      if (this.shouldIgnoreClick()) return;
      if (this.isSelectedOp(opValue)) { this.selectedItem = null; this.message = "Select a number or operation"; return; }
      this.selectedItem = { kind: "op", op: opValue };
      this.message = "Select a blue space";
    },

    selectPlacedOp(lineIndex) {
      if (this.gameState !== "playing") return;
      if (this.shouldIgnoreClick()) return;
      if (!this.lines[lineIndex].op) return;
      if (this.isSelectedPlacedOp(lineIndex)) { this.selectedItem = null; this.message = "Select a number or operation"; return; }
      this.selectedItem = { kind: "op", source: "placed_op", fromLineIndex: lineIndex, op: this.lines[lineIndex].op };
      this.message = "Select a blue space";
    },

    slotCanAccept(lineIndex, slotKey) {
      const selection = this.currentSelection();
      if (!selection || selection.kind !== "tile") return false;
      if (!(slotKey === "aRef" || slotKey === "bRef")) return false;
      if (selection.source === "placed" && selection.fromLineIndex === lineIndex && selection.fromSlotKey === slotKey) return false;
      const incomingRef = this.makeTileRefFromSelection(selection);
      if (!incomingRef) return false;
      if (this.wouldCreateCircularReference(incomingRef, lineIndex)) return false;
      return true;
    },

    opSlotCanAccept(lineIndex) {
      const selection = this.currentSelection();
      if (!selection || selection.kind !== "op") return false;
      if (selection.source === "placed_op" && selection.fromLineIndex === lineIndex) return false;
      return true;
    },

    bankCanAcceptPlacedTile(tileId) {
      const selection = this.currentSelection();
      if (!selection || selection.kind !== "tile") return false;
      if (selection.source !== "placed") return false;
      const movingRef = this.makeTileRefFromSelection(selection);
      return movingRef?.source === "start" && movingRef.id === tileId;
    },

    resultHomeCanAccept(lineIndex) {
      const selection = this.currentSelection();
      if (!selection || selection.kind !== "tile") return false;
      if (selection.source !== "placed") return false;
      const movingRef = this.makeTileRefFromSelection(selection);
      if (!movingRef || movingRef.source !== "result") return false;
      return movingRef.id === this.resultTileIdForLine(lineIndex);
    },

    opHomeCanAccept(opValue) {
      const selection = this.currentSelection();
      if (!selection || selection.kind !== "op") return false;
      if (selection.source !== "placed_op") return false;
      return selection.op === opValue;
    },

    returnPlacedOpToHome(opValue) {
      if (this.gameState !== "playing") return;
      if (this.shouldIgnoreClick()) return;
      if (!this.opHomeCanAccept(opValue)) return;
      this.clearOriginIfPlaced(this.selectedItem);
      this.selectedItem = null;
      this.refreshBest();
      this.message = "Returned operation home";
    },

    placeIntoTileSlot(lineIndex, slotKey) {
      if (this.gameState !== "playing") return;
      if (this.shouldIgnoreClick()) return;
      if (!this.slotCanAccept(lineIndex, slotKey)) { this.message = "Invalid: circular reference"; return; }
      const incomingRef = this.makeTileRefFromSelection(this.selectedItem);
      if (!incomingRef) return;
      const replaced = this.lines[lineIndex][slotKey];
      const originSelection = this.selectedItem;
      this.clearOriginIfPlaced(originSelection);
      this.lines[lineIndex][slotKey] = incomingRef;
      if (originSelection?.source === "placed" && replaced) {
        this.lines[originSelection.fromLineIndex][originSelection.fromSlotKey] = replaced;
      }
      this.selectedItem = null;
      this.refreshBest();
      this.message = "Select a number or operation";
    },

    placeIntoOpSlot(lineIndex) {
      if (this.gameState !== "playing") return;
      if (this.shouldIgnoreClick()) return;
      if (!this.opSlotCanAccept(lineIndex)) return;
      const incomingOp = this.selectedItem.op;
      const replaced = this.lines[lineIndex].op;
      const originSelection = this.selectedItem;
      this.clearOriginIfPlaced(originSelection);
      this.lines[lineIndex].op = incomingOp;
      if (originSelection?.source === "placed_op" && replaced) {
        this.lines[originSelection.fromLineIndex].op = replaced;
      }
      this.selectedItem = null;
      this.refreshBest();
      this.message = "Select a number or operation";
    },

    returnPlacedTileToBank(tileId) {
      if (this.gameState !== "playing") return;
      if (this.shouldIgnoreClick()) return;
      if (!this.bankCanAcceptPlacedTile(tileId)) return;
      this.clearOriginIfPlaced(this.selectedItem);
      this.selectedItem = null;
      this.refreshBest();
      this.message = "Returned to top";
    },

    returnPlacedResultToHome(lineIndex) {
      if (this.gameState !== "playing") return;
      if (this.shouldIgnoreClick()) return;
      if (!this.resultHomeCanAccept(lineIndex)) return;
      this.clearOriginIfPlaced(this.selectedItem);
      this.selectedItem = null;
      this.refreshBest();
      this.message = "Returned result home";
    },

    clearAllWorking() {
      if (this.gameState !== "playing") return;
      this.selectedItem = null;
      this.lines = Array.from({ length: 5 }, () => this.makeEmptyLine());
      this.message = "Select a number or operation";
    },

    cloneRef(ref) { return ref ? { ...ref } : null; },

    cloneLines(lines = this.lines) {
      return lines.map((line) => ({ aRef: this.cloneRef(line.aRef), op: line.op, bRef: this.cloneRef(line.bRef) }));
    },

    restoreBest() {
      if (!this.bestSnapshot) return;
      this.selectedItem = null;
      this.lines = this.cloneLines(this.bestSnapshot);
      this.message = `Restored best: ${this.bestValue}`;
    },

    refreshBest() {
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
        this.bestSnapshot = this.cloneLines();
      }
      if (gap === 0 && this.gameState === "playing") {
        this.timeToSolve = this.activeMode.duration - this.timerSeconds;
        this.stopTimer();
        this.gameState = "finished";
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
        if (b === 0 || a % b !== 0) return { valid: false, ready: true, value: null };
        return { valid: true, ready: true, value: a / b };
      }
      return { valid: false, ready: false, value: null };
    },

    beginPointerDrag(payload, event) {
      if (this.gameState !== "playing") return;
      this.dragState = { active: false, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, payload };
    },

    onDragStartTile(tileId, event) {
      if (this.isStartTileUsed(tileId)) return;
      this.beginPointerDrag({ kind: "tile", source: "start", tileId }, event);
    },

    onDragStartResult(lineIndex, event) {
      if (!this.lineHasResult(lineIndex) || this.isResultTileUsed(lineIndex)) return;
      this.beginPointerDrag({ kind: "tile", source: "result", tileId: this.resultTileIdForLine(lineIndex) }, event);
    },

    onDragStartPlacedTile(lineIndex, slotKey, event) {
      const ref = this.lines[lineIndex][slotKey];
      if (!ref) return;
      this.beginPointerDrag({ kind: "tile", source: "placed", fromLineIndex: lineIndex, fromSlotKey: slotKey }, event);
    },

    onDragStartOp(opValue, event) {
      this.beginPointerDrag({ kind: "op", op: opValue }, event);
    },

    onDragStartPlacedOp(lineIndex, event) {
      if (!this.lines[lineIndex].op) return;
      this.beginPointerDrag({ kind: "op", source: "placed_op", fromLineIndex: lineIndex, op: this.lines[lineIndex].op }, event);
    },

    onGlobalPointerMove(event) {
      if (this.dragState.pointerId !== event.pointerId || !this.dragState.payload) return;
      if (!this.dragState.active) {
        const dx = event.clientX - this.dragState.startX;
        const dy = event.clientY - this.dragState.startY;
        if ((dx * dx) + (dy * dy) < 64) return;
        this.dragState.active = true;
        this.selectedItem = this.dragState.payload;
        this.message = this.dragState.payload.kind === "tile" ? "Release on a green space" : "Release on an operator space";
      }
    },

    finishPointerDrag() {
      this.dragState = { active: false, pointerId: null, startX: 0, startY: 0, payload: null };
    },

    handleDropTarget(target) {
      if (!target || !this.dragState.active || !this.dragState.payload) return false;
      const dropKind = target.dataset.dropKind;
      if (dropKind === "tile-slot") { this.placeIntoTileSlot(Number(target.dataset.lineIndex), target.dataset.slotKey); return true; }
      if (dropKind === "op-slot") { this.placeIntoOpSlot(Number(target.dataset.lineIndex)); return true; }
      if (dropKind === "op-home") { this.returnPlacedOpToHome(target.dataset.opValue); return true; }
      if (dropKind === "bank-tile") { this.returnPlacedTileToBank(target.dataset.tileId); return true; }
      if (dropKind === "result-home") { this.returnPlacedResultToHome(Number(target.dataset.lineIndex)); return true; }
      return false;
    },

    onGlobalPointerUp(event) {
      if (this.dragState.pointerId !== event.pointerId) return;
      const wasDragging = this.dragState.active;
      if (wasDragging) {
        const el = document.elementFromPoint(event.clientX, event.clientY);
        const dropTarget = el ? el.closest("[data-drop-kind]") : null;
        this.handleDropTarget(dropTarget);
        this.suppressClickUntil = Date.now() + 80;
      }
      this.finishPointerDrag();
      if (wasDragging && !this.selectedItem) this.message = "Select a number or operation";
    },

    onGlobalPointerCancel(event) {
      if (this.dragState.pointerId !== event.pointerId) return;
      this.finishPointerDrag();
    },

    generatePuzzle(mode) {
      const now = new Date();
      const slot = mode.daily ? this.localDateStamp(now) : this.utcSlotStamp(now, mode.duration || 300);
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

      return { numbers: nums, target: 100 + Math.floor(rand() * 900), seedLabel: slot };
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
            <div class="numbers-brand">
              <div class="numbers-title">Numbers</div>
              <div class="numbers-sub">
                {{ gameState === 'pregame'
                  ? 'Pick game mode'
                  : activeMode.title + ' · ' + seedLabel }}
              </div>
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

          <div class="numbers-modes">
            <button
              v-for="mode in modes"
              :key="mode.id"
              class="numbers-mode-button"
              :class="{ active: mode.id === activeModeId }"
              type="button"
              @click="selectMode(mode.id)"
            >
              {{ mode.title }}
            </button>
          </div>
        </section>

        <section class="numbers-board">

          <!-- ── PRE-GAME ─────────────────────────────────────────── -->
          <template v-if="gameState === 'pregame'">
            <div class="numbers-status">
              <div class="numbers-target">
                <div class="numbers-label">Target</div>
                <div class="numbers-target-value">—</div>
              </div>
              <div class="numbers-message">
                <div class="numbers-label">Now</div>
                <div class="numbers-message-text">Pick a mode to start</div>
              </div>
            </div>

            <div class="numbers-bank">
              <div class="numbers-bank-head">
                <div class="numbers-label">Numbers</div>
                <div class="numbers-label">0 live</div>
              </div>
              <div class="numbers-bank-grid">
                <button v-for="n in 6" :key="'pregame-bank-' + n" class="numbers-tile" type="button" disabled>
                  <div class="numbers-tile-value">&nbsp;</div>
                </button>
              </div>
            </div>

            <div class="numbers-work-area">
              <div class="numbers-lines">
                <div v-for="n in 5" :key="'pregame-line-' + n" class="numbers-line">
                  <button class="numbers-slot-button is-empty" type="button" disabled></button>
                  <button class="numbers-op-slot is-empty" type="button" disabled></button>
                  <button class="numbers-slot-button is-empty" type="button" disabled></button>
                  <div class="numbers-equals">=</div>
                  <button class="numbers-slot-button is-result is-empty" type="button" disabled></button>
                </div>
              </div>
              <div class="numbers-ops-column">
                <button v-for="op in ops" :key="'pregame-op-' + op.value" class="numbers-op-button" type="button" disabled>
                  <span>{{ op.label }}</span>
                </button>
              </div>
            </div>

            <div class="numbers-bottom">
              <button type="button" disabled>Solution</button>
              <button type="button" @click="startMode(activeModeId)">Start Game</button>
              <button type="button" disabled title="Copy result">⧉</button>
            </div>
          </template>

          <!-- ── PLAYING / FINISHED ──────────────────────────────── -->
          <template v-else>

            <!-- Finished banner -->
            <div v-if="gameState === 'finished'" class="numbers-finished-banner">
              <span class="numbers-finished-icon">{{ bestGap === 0 ? '🎉' : '🏁' }}</span>
              <span class="numbers-finished-text">{{ finishedMessage }}</span>
            </div>

            <div class="numbers-status">
              <div class="numbers-target">
                <div class="numbers-label">Target</div>
                <div class="numbers-target-value">{{ target }}</div>
              </div>
              <div class="numbers-message">
                <div class="numbers-label">{{ gameState === 'finished' ? 'Result' : 'Now' }}</div>
                <div class="numbers-message-text">{{ gameState === 'finished' ? finishedMessage : message }}</div>
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
                  :data-drop-kind="'bank-tile'"
                  :data-tile-id="tile.id"
                  type="button"
                  @click="bankCanAcceptPlacedTile(tile.id) ? returnPlacedTileToBank(tile.id) : selectStartTile(tile.id)"
                  @pointerdown="onDragStartTile(tile.id, $event)"
                >
                  <div class="numbers-tile-value">{{ tile.value }}</div>
                </button>
              </div>
            </div>

            <div class="numbers-work-area">
              <div class="numbers-lines">
                <div v-for="(line, lineIndex) in lines" :key="lineIndex" class="numbers-line">

                  <!-- A slot -->
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
                    data-drop-kind="tile-slot"
                    :data-line-index="lineIndex"
                    data-slot-key="aRef"
                    type="button"
                    @click="line.aRef ? selectPlacedTile(lineIndex, 'aRef') : placeIntoTileSlot(lineIndex, 'aRef')"
                    @pointerdown="line.aRef ? onDragStartPlacedTile(lineIndex, 'aRef', $event) : null"
                  >
                    <span v-if="lines[lineIndex].aRef && lines[lineIndex].aRef.source === 'result'" class="numbers-derived-label">
                      {{ derivedLabel(resultLineIndexFromId(lines[lineIndex].aRef.id)) }}
                    </span>
                    <span v-if="lineDisplayValue(lineIndex, 'aRef') !== ''" class="numbers-slot-big">
                      {{ lineDisplayValue(lineIndex, 'aRef') }}
                    </span>
                  </button>

                  <!-- Op slot -->
                  <button
                    class="numbers-op-slot"
                    :class="{
                      'is-empty': !line.op,
                      'is-filled': !!line.op,
                      'is-valid-drop': opSlotCanAccept(lineIndex),
                      'is-selected': isSelectedPlacedOp(lineIndex)
                    }"
                    data-drop-kind="op-slot"
                    :data-line-index="lineIndex"
                    type="button"
                    @click="opSlotCanAccept(lineIndex) ? placeIntoOpSlot(lineIndex) : line.op ? selectPlacedOp(lineIndex) : null"
                    @pointerdown="line.op ? onDragStartPlacedOp(lineIndex, $event) : null"
                  >
                    <span v-if="line.op" class="numbers-op-big">
                      {{ line.op === '*' ? '×' : line.op === '/' ? '÷' : line.op === '-' ? '−' : '+' }}
                    </span>
                  </button>

                  <!-- B slot -->
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
                    data-drop-kind="tile-slot"
                    :data-line-index="lineIndex"
                    data-slot-key="bRef"
                    type="button"
                    @click="line.bRef ? selectPlacedTile(lineIndex, 'bRef') : placeIntoTileSlot(lineIndex, 'bRef')"
                    @pointerdown="line.bRef ? onDragStartPlacedTile(lineIndex, 'bRef', $event) : null"
                  >
                    <span v-if="lines[lineIndex].bRef && lines[lineIndex].bRef.source === 'result'" class="numbers-derived-label">
                      {{ derivedLabel(resultLineIndexFromId(lines[lineIndex].bRef.id)) }}
                    </span>
                    <span v-if="lineDisplayValue(lineIndex, 'bRef') !== ''" class="numbers-slot-big">
                      {{ lineDisplayValue(lineIndex, 'bRef') }}
                    </span>
                  </button>

                  <div class="numbers-equals">=</div>

                  <!-- Result slot -->
                  <button
                    class="numbers-slot-button is-result"
                    :class="{
                      'is-empty': !lineHasResult(lineIndex),
                      'is-filled': lineHasResult(lineIndex),
                      'is-used': lineHasResult(lineIndex) && isResultTileUsed(lineIndex),
                      'is-selected': isSelectedResultTile(lineIndex),
                      'is-valid-drop': resultHomeCanAccept(lineIndex),
                      'is-derived': lineHasResult(lineIndex),
                      'is-invalid': resultIsInvalid(lineIndex)
                    }"
                    :data-drop-kind="'result-home'"
                    :data-line-index="lineIndex"
                    type="button"
                    @click="resultHomeCanAccept(lineIndex) ? returnPlacedResultToHome(lineIndex) : selectResultTile(lineIndex)"
                    @pointerdown="lineHasResult(lineIndex) ? onDragStartResult(lineIndex, $event) : null"
                  >
                    <span v-if="lineComputedResult(lineIndex).valid" class="numbers-derived-label">
                      {{ derivedLabel(lineIndex) }}
                    </span>
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
                  :class="{
                    'is-selected': isSelectedOp(op.value),
                    'is-valid-drop': opHomeCanAccept(op.value)
                  }"
                  :data-drop-kind="'op-home'"
                  :data-op-value="op.value"
                  type="button"
                  @click="opHomeCanAccept(op.value) ? returnPlacedOpToHome(op.value) : selectOp(op.value)"
                  @pointerdown="onDragStartOp(op.value, $event)"
                >
                  <span>{{ op.label }}</span>
                </button>
              </div>
            </div>

            <!-- Single bottom bar — labels change at end of game -->
            <div class="numbers-bottom">
              <button
                type="button"
                :class="{ 'numbers-bottom-highlight': gameState === 'finished' }"
                @click="gameState === 'finished' ? showComputerSolution() : clearAllWorking()"
              >
                {{ gameState === 'finished' ? (showSolution ? 'Hide' : 'Solution') : 'Clear' }}
              </button>
              <button
                type="button"
                @click="restoreBest"
                :disabled="!bestSnapshot"
              >
                {{ restoreBestText }}
              </button>
              <button
                type="button"
                :disabled="!canCopy"
                :title="canCopy ? 'Copy result' : 'Finish game to copy'"
                @click="copyResult"
              >
                ⧉
              </button>
            </div>

            <!-- Solution panel — scrolled into view when opened -->
            <div
              v-if="showSolution && solutionText"
              id="solution-panel"
              class="numbers-solution-panel"
            >
              <div class="numbers-label">Best Solution</div>
              <pre class="numbers-solution-text">{{ solutionText }}</pre>
            </div>

          </template>
        </section>
      </div>
    </main>
  `,
}).mount("#app");