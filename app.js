const { createApp } = Vue;

// ─────────────────────────────────────────────────────────────────────────────
// PUZZLE CONFIG — easy to tweak
// ─────────────────────────────────────────────────────────────────────────────
const PUZZLE_CONFIG = {
  dailyLargeProbabilities: [0.35, 0.55, 0.10],

  familyLargeCount: 2,
  classLargeCount: 1,

  largeTiles: [25, 50, 75, 100],
  smallTiles: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],

  weirdSubModes: [
    { id: "zero-large", label: "0 Large", largeCount: 0, largeTiles: null },
    { id: "three-large", label: "3 Large", largeCount: 3, largeTiles: null },
    { id: "four-large", label: "4 Large", largeCount: 4, largeTiles: null },
    { id: "diff-large", label: "Diff Large", largeCount: null, largeTiles: [30, 80, 120, 200] },
  ],
};

createApp({
  data() {
    return {
      activeModeId: "daily",
      timerSeconds: 0,
      timerId: null,
      currentSlotKey: null,
      slotTimerId: null,
      target: null,
      seedLabel: "",
      modeSubLabel: "",
      gameState: "pregame",

      timeToSolve: null,
      startTiles: [],
      startTileIdCounter: 0,
      lines: [],
      selectedItem: null,

      bestValue: null,
      bestGap: null,
      bestSnapshot: null,

      solutionText: null,
      showSolution: false,

      message: "Choose a mode, then press Start",

      dragState: { active: false, pointerId: null, startX: 0, startY: 0, payload: null },
      suppressClickUntil: 0,

      modes: [
        { id: "daily", title: "Daily", slotMinutes: 1440 },
        { id: "family", title: "Family", slotMinutes: 5 },
        { id: "class", title: "Class", slotMinutes: 5 },
        { id: "weird", title: "Weird", slotMinutes: 5 },
      ],

      modeSubLabels: {},

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

    timerDuration() {
      return 60;
      return this.activeModeId === "daily" ? 60 : 300;
    },

    timeText() {
      const total = Math.max(0, this.timerSeconds || 0);
      const mins = Math.floor(total / 60);
      const secs = total % 60;
      return `${mins}:${String(secs).padStart(2, "0")}`;
    },

    liveCount() {
      if (this.gameState === "pregame") return 0;

      let count = 0;
      for (const tile of this.startTiles) {
        if (!this.isStartTileUsed(tile.id)) count += 1;
      }
      for (let i = 0; i < this.lines.length; i += 1) {
        if (this.lineHasResult(i) && !this.isResultTileUsed(i)) count += 1;
      }
      return count;
    },

    restoreBestText() {
      if (this.gameState === "pregame") return "Start";
      return this.bestValue == null ? "Restore" : `Restore ${this.bestValue}`;
    },

    statusMessage() {
      if (this.gameState === "finished") return this.finishedMessage;
      return this.message;
    },

    finishedMessage() {
      if (this.bestGap === 0 && this.timeToSolve != null) {
        return `Solved in ${this.formatTime(this.timeToSolve)}!`;
      }
      if (this.bestGap != null && this.bestGap > 0) {
        return `Finished · ${this.bestGap} away`;
      }
      if (this.bestGap === 0) return "Solved!";
      return "Time's up!";
    },

    canCopy() {
      return this.gameState === "finished";
    },
  },

  mounted() {
    this.refreshSubLabels();
    this.startSlotWatcher();
    this.activeModeId = "daily";

    const seedLabel = this.computeSeedLabel("daily");
    const saved = this.loadState("daily", seedLabel);

    if (saved) {
      this.restoreSavedState(saved);
    } else {
      this.resetToPregame();
      this.activeModeId = "daily";
    }

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
    resetToPregame() {
      this.stopTimer();
      this.stopSlotWatcher();
      this.target = null;
      this.seedLabel = "";
      this.timerSeconds = 0;
      this.gameState = "pregame";
      this.startTiles = [];
      this.lines = [];
      this.selectedItem = null;
      this.bestValue = null;
      this.bestGap = null;
      this.bestSnapshot = null;
      this.timeToSolve = null;
      this.solutionText = null;
      this.showSolution = false;
      this.message = "Choose a mode, then press Start";
    },

    selectMode(modeId) {
      if (this.gameState === "playing") this.saveState(this.activeModeId);

      this.activeModeId = modeId;
      this.refreshSubLabels();
      this.startSlotWatcher();
      const seedLabel = this.computeSeedLabel(modeId);
      const saved = this.loadState(modeId, seedLabel);

      if (saved) {
        this.restoreSavedState(saved);
        return;
      }

      this.resetToPregame();
      this.activeModeId = modeId;
    },

    startSelectedMode() {
      const modeId = this.activeModeId;
      const seedLabel = this.computeSeedLabel(modeId);
      const saved = this.loadState(modeId, seedLabel);

      if (saved) {
        this.restoreSavedState(saved);
      } else {
        this.newBoard(modeId, seedLabel);
      }
    },
    getCurrentSlotKey(slotMinutes) {
      const now = new Date();
      const totalMins = now.getHours() * 60 + now.getMinutes();
      return Math.floor(totalMins / slotMinutes);
    },
    startSlotWatcher() {
      this.stopSlotWatcher();

      const mode = this.activeMode;
      if (mode.id === "daily") return; // no need

      this.currentSlotKey = this.getCurrentSlotKey(mode.slotMinutes);

      this.slotTimerId = setInterval(() => {
        const newKey = this.getCurrentSlotKey(mode.slotMinutes);

        if (newKey !== this.currentSlotKey) {
          this.currentSlotKey = newKey;
          this.refreshSubLabels();
        }
      }, 1000);
    },    
    stopSlotWatcher() {
      if (this.slotTimerId) {
        clearInterval(this.slotTimerId);
        this.slotTimerId = null;
      }
    },
    restoreSavedState(saved) {
      this.stopTimer();

      this.target = saved.target;
      this.seedLabel = saved.seedLabel;
      this.startTiles = saved.startTiles || [];
      this.startTileIdCounter = this.startTiles.length;
      this.lines = saved.lines || Array.from({ length: 5 }, () => this.makeEmptyLine());
      this.bestValue = saved.bestValue;
      this.bestGap = saved.bestGap;
      this.bestSnapshot = saved.bestSnapshot;
      this.timeToSolve = saved.timeToSolve;
      this.selectedItem = null;
      this.solutionText = null;
      this.showSolution = false;
      this.gameState = saved.gameState || "playing";

      if (this.gameState === "playing") {
        this.timerSeconds = saved.timerSeconds || this.timerDuration;
        this.startTimer();
        this.message = "Select a number or operation";
      } else {
        this.timerSeconds = saved.timerSeconds || 0;
        this.message = this.finishedMessage;
      }
    },

    localSlotLabel(slotMinutes) {
      const now = new Date();
      const slotStart = Math.floor(
        (now.getHours() * 60 + now.getMinutes()) / slotMinutes
      ) * slotMinutes;
      const hh = String(Math.floor(slotStart / 60)).padStart(2, "0");
      const mm = String(slotStart % 60).padStart(2, "0");
      return `(${hh}:${mm})`;
    },

    refreshSubLabels() {
      const labels = {};
      for (const mode of this.modes) {
        if (mode.id === "daily") continue;
        labels[mode.id] = this.localSlotLabel(mode.slotMinutes);
      }
      this.modeSubLabels = labels;
    },

    saveKey(modeId, seedLabel) {
      return `numbers|${modeId}|${seedLabel}`;
    },

    saveState(modeId) {
      if (!this.seedLabel) return;
      const key = this.saveKey(modeId, this.seedLabel);
      const data = {
        gameState: this.gameState,
        target: this.target,
        seedLabel: this.seedLabel,
        startTiles: this.startTiles,
        lines: this.cloneLines(),
        bestValue: this.bestValue,
        bestGap: this.bestGap,
        bestSnapshot: this.bestSnapshot ? this.cloneLines(this.bestSnapshot) : null,
        timeToSolve: this.timeToSolve,
        timerSeconds: this.timerSeconds,
      };
      try {
        localStorage.setItem(key, JSON.stringify(data));
      } catch (_) {}
    },

    loadState(modeId, seedLabel) {
      const key = this.saveKey(modeId, seedLabel);
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      } catch (_) {
        return null;
      }
    },

    newBoard(modeId, seedLabel) {
      this.stopTimer();

      this.selectedItem = null;
      this.bestValue = null;
      this.bestGap = null;
      this.bestSnapshot = null;
      this.solutionText = null;
      this.showSolution = false;
      this.timeToSolve = null;
      this.dragState = { active: false, pointerId: null, startX: 0, startY: 0, payload: null };

      const puzzle = this.generatePuzzle(modeId || this.activeModeId, seedLabel);
      this.target = puzzle.target;
      this.seedLabel = puzzle.seedLabel;

      this.startTileIdCounter = 0;
      this.startTiles = puzzle.numbers.map((value) => ({ id: this.makeStartTileId(), value }));
      this.lines = Array.from({ length: 5 }, () => this.makeEmptyLine());

      this.gameState = "playing";
      this.timerSeconds = this.timerDuration;
      this.startTimer();
      this.message = "Select a number or operation";

      this.saveState(this.activeModeId);
    },

    computeSeedLabel(modeId) {
      const now = new Date();
      if (modeId === "daily") return this.localDateStamp(now);
      const mode = this.modes.find((m) => m.id === modeId);
      return this.localSlotStamp(now, mode.slotMinutes);
    },

    copyResult() {
      if (this.gameState !== "finished") return;

      let resultText = "";
      if (this.bestGap === 0 && this.timeToSolve != null) {
        resultText = `Solved in ${this.formatTime(this.timeToSolve)}`;
      } else if (this.bestGap != null) {
        resultText = `Off by ${this.bestGap}`;
      } else {
        resultText = "No solution found";
      }

      const text = `Numbers ${this.activeMode.title}\n${this.seedLabel}\nTarget: ${this.target}\n${resultText}`;
      navigator.clipboard.writeText(text).then(() => {
        this.message = "Copied!";
      });
    },

    showComputerSolution() {
      if (this.gameState !== "finished") return;

      if (this.solutionText) {
        this.showSolution = !this.showSolution;
        if (this.showSolution) {
          this.$nextTick(() =>
            document.getElementById("solution-panel")?.scrollIntoView({ behavior: "smooth", block: "start" })
          );
        }
        return;
      }

      this.solutionText = this.findBestSolution(this.startTiles.map((t) => t.value), this.target);
      this.showSolution = true;
      this.$nextTick(() =>
        document.getElementById("solution-panel")?.scrollIntoView({ behavior: "smooth", block: "start" })
      );
    },

    findBestSolution(numbers, target) {
      const EPS = 1e-9;

      const cleanNumbers = numbers
        .map(Number)
        .filter((n) => Number.isFinite(n) && n > 0);

      if (!cleanNumbers.length || !Number.isFinite(target)) {
        return "No valid numbers or target found.";
      }

      let best = null;
      let foundExact = false;

      const makeItem = (value) => ({
        value,
        text: String(value),
        steps: [],
        used: 0,
      });

      const startItems = cleanNumbers.map(makeItem);
      const maxDepth = cleanNumbers.length - 1;

      const isBetter = (candidate, currentBest) => {
        if (!currentBest) return true;

        const candidateDiff = Math.abs(candidate.value - target);
        const bestDiff = Math.abs(currentBest.value - target);

        if (candidateDiff < bestDiff) return true;
        if (candidateDiff > bestDiff) return false;

        if (candidate.steps.length < currentBest.steps.length) return true;
        if (candidate.steps.length > currentBest.steps.length) return false;

        return candidate.text.length < currentBest.text.length;
      };

      const consider = (item) => {
        if (isBetter(item, best)) {
          best = item;
        }

        if (Math.abs(item.value - target) < EPS) {
          foundExact = true;
          return true;
        }

        return false;
      };

      const stateKey = (items) =>
        items
          .map((item) => item.value)
          .sort((a, b) => a - b)
          .join(",");

      const combine = (a, b) => {
        const results = [];

        const addResult = (value, symbol, left, right) => {
          if (!Number.isFinite(value)) return;
          if (value <= 0) return;
          if (Math.abs(value - Math.round(value)) > EPS) return;

          value = Math.round(value);

          const step = `${left.text} ${symbol} ${right.text} = ${value}`;

          results.push({
            value,
            text: String(value),
            steps: [...left.steps, ...right.steps, step],
            used: left.used + right.used + 1,
          });
        };

        // Addition: commutative, so only once
        addResult(a.value + b.value, "+", a, b);

        // Multiplication: commutative, so only once
        // Prune multiplication by 1 because it does not create a useful new result
        if (a.value !== 1 && b.value !== 1) {
          addResult(a.value * b.value, "×", a, b);
        }

        // Subtraction: only positive results
        if (a.value > b.value) {
          addResult(a.value - b.value, "−", a, b);
        } else if (b.value > a.value) {
          addResult(b.value - a.value, "−", b, a);
        }

        // Division: only exact integer division
        // Prune division by 1 because it does not create a useful new result
        if (b.value !== 1 && a.value % b.value === 0) {
          addResult(a.value / b.value, "÷", a, b);
        }

        if (a.value !== 1 && b.value % a.value === 0) {
          addResult(b.value / a.value, "÷", b, a);
        }

        // Prefer results closer to the target
        results.sort((x, y) => {
          const dx = Math.abs(x.value - target);
          const dy = Math.abs(y.value - target);
          return dx - dy;
        });

        return results;
      };

      const search = (items, depthLimit, seen) => {
        for (const item of items) {
          if (consider(item)) return true;
        }

        const currentDepth = Math.max(...items.map((item) => item.used));

        if (currentDepth >= depthLimit) return false;
        if (items.length < 2) return false;

        const key = `${stateKey(items)}|${currentDepth}`;
        if (seen.has(key)) return false;
        seen.add(key);

        for (let i = 0; i < items.length; i++) {
          for (let j = i + 1; j < items.length; j++) {
            const a = items[i];
            const b = items[j];

            const remaining = items.filter((_, index) => index !== i && index !== j);
            const nextResults = combine(a, b);

            for (const result of nextResults) {
              const nextItems = [...remaining, result];

              if (search(nextItems, depthLimit, seen)) {
                return true;
              }
            }
          }
        }

        return false;
      };

      // Iterative deepening:
      // Search 0-step, then 1-step, then 2-step solutions, etc.
      // Therefore the first exact solution found is a shortest exact solution.
      for (let depthLimit = 0; depthLimit <= maxDepth; depthLimit++) {
        const seen = new Set();

        if (search(startItems, depthLimit, seen)) {
          break;
        }

        if (foundExact) break;
      }

      if (!best) {
        return (
          `No solution found.\n\n` +
          `Numbers available: ${cleanNumbers.join(", ")}\n` +
          `Target: ${target}`
        );
      }

      const diff = Math.abs(best.value - target);

      if (best.steps.length === 0) {
        return (
          `Best result: ${best.value}\n` +
          `Target: ${target}\n` +
          `Difference: ${diff}\n\n` +
          `The target was already one of the available numbers.`
        );
      }

      return (
        `${diff === 0 ? "Exact solution" : "Closest solution"}: ${best.value}\n` +
        `Target: ${target}\n` +
        `Difference: ${diff}\n\n` +
        best.steps.map((step, index) => `${index + 1}. ${step}`).join("\n")
      );
    },

    generatePuzzle(modeId, seedLabel) {
      const sl = seedLabel || this.computeSeedLabel(modeId);
      const seedString = `numbers|${modeId}|${sl}`;
      const rand = this.mulberry32(this.fnv1a32(seedString));

      const cfg = PUZZLE_CONFIG;
      let largePool = [...cfg.largeTiles];
      const smallBag = [...cfg.smallTiles, ...cfg.smallTiles];

      let largeCount = 0;
      let nums = [];

      if (modeId === "daily") {
        const probs = cfg.dailyLargeProbabilities;
        const r = rand();
        let cum = 0;
        for (let i = 0; i < probs.length; i++) {
          cum += probs[i];
          if (r < cum) {
            largeCount = i + 1;
            break;
          }
        }
        largeCount = largeCount || probs.length;
      } else if (modeId === "family") {
        largeCount = cfg.familyLargeCount;
      } else if (modeId === "class") {
        largeCount = cfg.classLargeCount;
      } else if (modeId === "weird") {
        const subModes = cfg.weirdSubModes;
        const subIdx = Math.floor(rand() * subModes.length);
        const sub = subModes[subIdx];

        if (sub.largeTiles) {
          largePool = [...sub.largeTiles];
          largeCount = 1 + Math.floor(rand() * largePool.length);
        } else {
          largeCount = sub.largeCount;
        }
      }

      const largeBag = [...largePool];
      for (let i = 0; i < largeCount; i++) {
        if (!largeBag.length) break;
        const pick = Math.floor(rand() * largeBag.length);
        nums.push(largeBag.splice(pick, 1)[0]);
      }

      const smallRemaining = [...smallBag];
      while (nums.length < 6) {
        const pick = Math.floor(rand() * smallRemaining.length);
        nums.push(smallRemaining.splice(pick, 1)[0]);
      }

      const largeSection = nums.slice(0, largeCount);
      const smallSection = nums.slice(largeCount);
      this.shuffle(smallSection, rand);
      nums = [...largeSection, ...smallSection];

      return {
        numbers: nums,
        target: 100 + Math.floor(rand() * 900),
        seedLabel: sl,
      };
    },

    localDateStamp(date) {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, "0");
      const d = String(date.getDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    },

    localSlotStamp(date, slotMinutes) {
      const totalMins = date.getHours() * 60 + date.getMinutes();
      const slotStart = Math.floor(totalMins / slotMinutes) * slotMinutes;
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, "0");
      const d = String(date.getDate()).padStart(2, "0");
      const hh = String(Math.floor(slotStart / 60)).padStart(2, "0");
      const mm = String(slotStart % 60).padStart(2, "0");
      return `${y}-${m}-${d} ${hh}:${mm}`;
    },

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
          this.saveState(this.activeModeId);
          return;
        }

        this.timerSeconds -= 1;
        if (this.timerSeconds % 10 === 0) this.saveState(this.activeModeId);
      }, 1000);
    },

    stopTimer() {
      if (this.timerId) {
        clearInterval(this.timerId);
        this.timerId = null;
      }
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
      for (let i = 0; i < this.lines.length; i++) {
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
          const dep = this.resultLineIndexFromId(ref.id);
          if (dep === targetLineIndex || this.lineDependsOnLine(dep, targetLineIndex, visited)) return true;
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
      return line && line.aRef != null && line.op != null && line.bRef != null;
    },

    lineComputedResult(lineIndex) {
      const line = this.lines[lineIndex];
      if (!line) return { valid: false, ready: false, value: null };

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

    resultIsInvalid(lineIndex) {
      const result = this.lineComputedResult(lineIndex);
      return result.ready && !result.valid;
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
      if (this.isSelectedStartTile(tileId)) {
        this.selectedItem = null;
        this.message = "Select a number or operation";
        return;
      }
      if (this.isStartTileUsed(tileId)) return;
      this.selectedItem = { kind: "tile", source: "start", tileId };
      this.message = "Select a slot";
    },

    selectResultTile(lineIndex) {
      if (this.gameState !== "playing") return;
      if (this.shouldIgnoreClick()) return;
      if (!this.lineHasResult(lineIndex)) return;
      if (this.isSelectedResultTile(lineIndex)) {
        this.selectedItem = null;
        this.message = "Select a number or operation";
        return;
      }
      if (this.isResultTileUsed(lineIndex)) return;
      this.selectedItem = { kind: "tile", source: "result", tileId: this.resultTileIdForLine(lineIndex) };
      this.message = "Select a slot";
    },

    selectPlacedTile(lineIndex, slotKey) {
      if (this.gameState !== "playing") return;
      if (this.shouldIgnoreClick()) return;
      if (!this.lines[lineIndex][slotKey]) return;
      if (this.isSelectedPlacedTile(lineIndex, slotKey)) {
        this.selectedItem = null;
        this.message = "Select a number or operation";
        return;
      }
      this.selectedItem = { kind: "tile", source: "placed", fromLineIndex: lineIndex, fromSlotKey: slotKey };
      this.message = "Select a slot or bank";
    },

    selectOp(opValue) {
      if (this.gameState !== "playing") return;
      if (this.shouldIgnoreClick()) return;
      if (this.isSelectedOp(opValue)) {
        this.selectedItem = null;
        this.message = "Select a number or operation";
        return;
      }
      this.selectedItem = { kind: "op", op: opValue };
      this.message = "Select an operator slot";
    },

    selectPlacedOp(lineIndex) {
      if (this.gameState !== "playing") return;
      if (this.shouldIgnoreClick()) return;
      if (!this.lines[lineIndex].op) return;
      if (this.isSelectedPlacedOp(lineIndex)) {
        this.selectedItem = null;
        this.message = "Select a number or operation";
        return;
      }
      this.selectedItem = { kind: "op", source: "placed_op", fromLineIndex: lineIndex, op: this.lines[lineIndex].op };
      this.message = "Select an operator slot";
    },

    slotCanAccept(lineIndex, slotKey) {
      const sel = this.currentSelection();
      if (!sel || sel.kind !== "tile") return false;
      if (!(slotKey === "aRef" || slotKey === "bRef")) return false;
      if (sel.source === "placed" && sel.fromLineIndex === lineIndex && sel.fromSlotKey === slotKey) return false;

      const incomingRef = this.makeTileRefFromSelection(sel);
      if (!incomingRef) return false;
      if (this.wouldCreateCircularReference(incomingRef, lineIndex)) return false;

      return true;
    },

    opSlotCanAccept(lineIndex) {
      const sel = this.currentSelection();
      if (!sel || sel.kind !== "op") return false;
      if (sel.source === "placed_op" && sel.fromLineIndex === lineIndex) return false;
      return true;
    },

    bankCanAcceptPlacedTile(tileId) {
      const sel = this.currentSelection();
      if (!sel || sel.kind !== "tile" || sel.source !== "placed") return false;
      const ref = this.makeTileRefFromSelection(sel);
      return ref?.source === "start" && ref.id === tileId;
    },

    resultHomeCanAccept(lineIndex) {
      const sel = this.currentSelection();
      if (!sel || sel.kind !== "tile" || sel.source !== "placed") return false;
      const ref = this.makeTileRefFromSelection(sel);
      if (!ref || ref.source !== "result") return false;
      return ref.id === this.resultTileIdForLine(lineIndex);
    },

    opHomeCanAccept(opValue) {
      const sel = this.currentSelection();
      if (!sel || sel.kind !== "op" || sel.source !== "placed_op") return false;
      return sel.op === opValue;
    },

    returnPlacedOpToHome(opValue) {
      if (this.gameState !== "playing") return;
      if (this.shouldIgnoreClick()) return;
      if (!this.opHomeCanAccept(opValue)) return;
      this.clearOriginIfPlaced(this.selectedItem);
      this.selectedItem = null;
      this.refreshBest();
      this.saveState(this.activeModeId);
      this.message = "Select a number or operation";
    },

    placeIntoTileSlot(lineIndex, slotKey) {
      if (this.gameState !== "playing") return;
      if (this.shouldIgnoreClick()) return;
      if (!this.slotCanAccept(lineIndex, slotKey)) {
        this.message = "Can't place there";
        return;
      }

      const incomingRef = this.makeTileRefFromSelection(this.selectedItem);
      if (!incomingRef) return;

      const replaced = this.lines[lineIndex][slotKey];
      const origin = this.selectedItem;

      this.clearOriginIfPlaced(origin);
      this.lines[lineIndex][slotKey] = incomingRef;

      if (origin?.source === "placed" && replaced) {
        this.lines[origin.fromLineIndex][origin.fromSlotKey] = replaced;
      }

      this.selectedItem = null;
      this.refreshBest();
      this.saveState(this.activeModeId);
      this.message = "Select a number or operation";
    },

    placeIntoOpSlot(lineIndex) {
      if (this.gameState !== "playing") return;
      if (this.shouldIgnoreClick()) return;
      if (!this.opSlotCanAccept(lineIndex)) return;

      const incomingOp = this.selectedItem.op;
      const replaced = this.lines[lineIndex].op;
      const origin = this.selectedItem;

      this.clearOriginIfPlaced(origin);
      this.lines[lineIndex].op = incomingOp;

      if (origin?.source === "placed_op" && replaced) {
        this.lines[origin.fromLineIndex].op = replaced;
      }

      this.selectedItem = null;
      this.refreshBest();
      this.saveState(this.activeModeId);
      this.message = "Select a number or operation";
    },

    returnPlacedTileToBank(tileId) {
      if (this.gameState !== "playing") return;
      if (this.shouldIgnoreClick()) return;
      if (!this.bankCanAcceptPlacedTile(tileId)) return;
      this.clearOriginIfPlaced(this.selectedItem);
      this.selectedItem = null;
      this.refreshBest();
      this.saveState(this.activeModeId);
      this.message = "Select a number or operation";
    },

    returnPlacedResultToHome(lineIndex) {
      if (this.gameState !== "playing") return;
      if (this.shouldIgnoreClick()) return;
      if (!this.resultHomeCanAccept(lineIndex)) return;
      this.clearOriginIfPlaced(this.selectedItem);
      this.selectedItem = null;
      this.refreshBest();
      this.saveState(this.activeModeId);
      this.message = "Select a number or operation";
    },

    clearAllWorking() {
      if (this.gameState !== "playing") return;
      this.selectedItem = null;
      this.lines = Array.from({ length: 5 }, () => this.makeEmptyLine());
      this.saveState(this.activeModeId);
      this.message = "Select a number or operation";
    },

    cloneRef(ref) {
      return ref ? { ...ref } : null;
    },

    cloneLines(lines = this.lines) {
      return lines.map((line) => ({
        aRef: this.cloneRef(line.aRef),
        op: line.op,
        bRef: this.cloneRef(line.bRef),
      }));
    },

    restoreBest() {
      if (this.gameState === "pregame") {
        this.startSelectedMode();
        return;
      }

      if (!this.bestSnapshot) return;

      this.selectedItem = null;
      this.lines = this.cloneLines(this.bestSnapshot);
      this.saveState(this.activeModeId);
      this.message = `Restored best: ${this.bestValue}`;
    },

    refreshBest() {
      for (let i = 0; i < this.lines.length; i++) {
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
        this.timeToSolve = this.timerDuration - this.timerSeconds;
        this.stopTimer();
        this.gameState = "finished";
        this.saveState(this.activeModeId);
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
      this.dragState = {
        active: false,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        payload,
      };
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
      if (!this.lines[lineIndex][slotKey]) return;
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

        if (dx * dx + dy * dy < 64) return;

        this.dragState.active = true;
        this.selectedItem = this.dragState.payload;
        this.message = this.dragState.payload.kind === "tile" ? "Release on a slot" : "Release on an operator slot";
      }
    },

    finishPointerDrag() {
      this.dragState = { active: false, pointerId: null, startX: 0, startY: 0, payload: null };
    },

    handleDropTarget(target) {
      if (!target || !this.dragState.active || !this.dragState.payload) return false;

      const k = target.dataset.dropKind;

      if (k === "tile-slot") {
        this.placeIntoTileSlot(Number(target.dataset.lineIndex), target.dataset.slotKey);
        return true;
      }

      if (k === "op-slot") {
        this.placeIntoOpSlot(Number(target.dataset.lineIndex));
        return true;
      }

      if (k === "op-home") {
        this.returnPlacedOpToHome(target.dataset.opValue);
        return true;
      }

      if (k === "bank-tile") {
        this.returnPlacedTileToBank(target.dataset.tileId);
        return true;
      }

      if (k === "result-home") {
        this.returnPlacedResultToHome(Number(target.dataset.lineIndex));
        return true;
      }

      return false;
    },

    onGlobalPointerUp(event) {
      if (this.dragState.pointerId !== event.pointerId) return;

      const wasDragging = this.dragState.active;

      if (wasDragging) {
        const el = document.elementFromPoint(event.clientX, event.clientY);
        this.handleDropTarget(el ? el.closest("[data-drop-kind]") : null);
        this.suppressClickUntil = Date.now() + 80;
      }

      this.finishPointerDrag();
      if (wasDragging && !this.selectedItem) this.message = "Select a number or operation";
    },

    onGlobalPointerCancel(event) {
      if (this.dragState.pointerId !== event.pointerId) return;
      this.finishPointerDrag();
    },

    fnv1a32(str) {
      let h = 0x811c9dc5;
      for (let i = 0; i < str.length; i++) {
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
      for (let i = arr.length - 1; i > 0; i--) {
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
                {{ gameState === 'pregame' ? 'Pick a mode, then press Start' : activeMode.title + ' · ' + seedLabel }}
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
              <span class="numbers-mode-title">{{ mode.title }}</span>
              <span v-if="mode.id !== 'daily'" class="numbers-mode-sub">{{ modeSubLabels[mode.id] || '' }}</span>
            </button>
          </div>
        </section>

        <section class="numbers-board">
          <div class="numbers-status">
            <div class="numbers-target">
              <div class="numbers-label">Target</div>
              <div class="numbers-target-value">{{ target || '—' }}</div>
            </div>

            <div class="numbers-message">
              <div class="numbers-message-text">{{ statusMessage }}</div>
            </div>
          </div>

          <div class="numbers-bank">
            <div class="numbers-bank-head">
              <div class="numbers-label">Numbers</div>
              <div class="numbers-label">{{ liveCount }} live</div>
            </div>

            <div class="numbers-bank-grid">
              <button
                v-for="(tile, tileIndex) in startTiles.length ? startTiles : Array(6).fill(null)"
                :key="tile ? tile.id : 'blank-tile-' + tileIndex"
                class="numbers-tile"
                :class="tile ? {
                  'is-used': isStartTileUsed(tile.id),
                  'is-selected': isSelectedStartTile(tile.id),
                  'is-valid-drop': bankCanAcceptPlacedTile(tile.id),
                } : { 'is-empty-placeholder': true }"
                :data-drop-kind="tile ? 'bank-tile' : null"
                :data-tile-id="tile ? tile.id : null"
                type="button"
                :disabled="!tile"
                @click="tile && (bankCanAcceptPlacedTile(tile.id) ? returnPlacedTileToBank(tile.id) : selectStartTile(tile.id))"
                @pointerdown="tile && onDragStartTile(tile.id, $event)"
              >
                <div class="numbers-tile-value">{{ tile ? tile.value : '' }}</div>
              </button>
            </div>
          </div>

          <div class="numbers-work-area">
            <div class="numbers-lines">
              <div
                v-for="(line, lineIndex) in lines.length ? lines : Array(5).fill(null)"
                :key="lineIndex"
                class="numbers-line"
              >
                <button
                  class="numbers-slot-button"
                  :class="line ? [
                    lineDisplayClass(lineIndex, 'aRef'),
                    {
                      'is-empty': lineDisplayValue(lineIndex, 'aRef') === '',
                      'is-filled': lineDisplayValue(lineIndex, 'aRef') !== '',
                      'is-valid-drop': slotCanAccept(lineIndex, 'aRef'),
                      'is-selected': isSelectedPlacedTile(lineIndex, 'aRef')
                    }
                  ] : ['is-empty']"
                  data-drop-kind="tile-slot"
                  :data-line-index="lineIndex"
                  data-slot-key="aRef"
                  type="button"
                  :disabled="!line"
                  @click="line && (line.aRef ? selectPlacedTile(lineIndex, 'aRef') : placeIntoTileSlot(lineIndex, 'aRef'))"
                  @pointerdown="line && line.aRef ? onDragStartPlacedTile(lineIndex, 'aRef', $event) : null"
                >
                  <span v-if="line && lines[lineIndex].aRef && lines[lineIndex].aRef.source === 'result'" class="numbers-derived-label">
                    {{ derivedLabel(resultLineIndexFromId(lines[lineIndex].aRef.id)) }}
                  </span>
                  <span v-if="line && lineDisplayValue(lineIndex, 'aRef') !== ''" class="numbers-slot-big">
                    {{ lineDisplayValue(lineIndex, 'aRef') }}
                  </span>
                </button>

                <button
                  class="numbers-op-slot"
                  :class="line ? {
                    'is-empty': !line.op,
                    'is-filled': !!line.op,
                    'is-valid-drop': opSlotCanAccept(lineIndex),
                    'is-selected': isSelectedPlacedOp(lineIndex)
                  } : {'is-empty': true}"
                  data-drop-kind="op-slot"
                  :data-line-index="lineIndex"
                  type="button"
                  :disabled="!line"
                  @click="line && (opSlotCanAccept(lineIndex) ? placeIntoOpSlot(lineIndex) : line.op ? selectPlacedOp(lineIndex) : null)"
                  @pointerdown="line && line.op ? onDragStartPlacedOp(lineIndex, $event) : null"
                >
                  <span v-if="line && line.op" class="numbers-op-big">
                    {{ line.op === '*' ? '×' : line.op === '/' ? '÷' : line.op === '-' ? '−' : '+' }}
                  </span>
                </button>

                <button
                  class="numbers-slot-button"
                  :class="line ? [
                    lineDisplayClass(lineIndex, 'bRef'),
                    {
                      'is-empty': lineDisplayValue(lineIndex, 'bRef') === '',
                      'is-filled': lineDisplayValue(lineIndex, 'bRef') !== '',
                      'is-valid-drop': slotCanAccept(lineIndex, 'bRef'),
                      'is-selected': isSelectedPlacedTile(lineIndex, 'bRef')
                    }
                  ] : ['is-empty']"
                  data-drop-kind="tile-slot"
                  :data-line-index="lineIndex"
                  data-slot-key="bRef"
                  type="button"
                  :disabled="!line"
                  @click="line && (line.bRef ? selectPlacedTile(lineIndex, 'bRef') : placeIntoTileSlot(lineIndex, 'bRef'))"
                  @pointerdown="line && line.bRef ? onDragStartPlacedTile(lineIndex, 'bRef', $event) : null"
                >
                  <span v-if="line && lines[lineIndex].bRef && lines[lineIndex].bRef.source === 'result'" class="numbers-derived-label">
                    {{ derivedLabel(resultLineIndexFromId(lines[lineIndex].bRef.id)) }}
                  </span>
                  <span v-if="line && lineDisplayValue(lineIndex, 'bRef') !== ''" class="numbers-slot-big">
                    {{ lineDisplayValue(lineIndex, 'bRef') }}
                  </span>
                </button>

                <div class="numbers-equals">=</div>

                <button
                  class="numbers-slot-button is-result"
                  :class="line ? {
                    'is-empty': !lineHasResult(lineIndex),
                    'is-filled': lineHasResult(lineIndex),
                    'is-used': lineHasResult(lineIndex) && isResultTileUsed(lineIndex),
                    'is-selected': isSelectedResultTile(lineIndex),
                    'is-valid-drop': resultHomeCanAccept(lineIndex),
                    'is-derived': lineHasResult(lineIndex),
                    'is-invalid': resultIsInvalid(lineIndex)
                  } : {'is-empty': true}"
                  :data-drop-kind="'result-home'"
                  :data-line-index="lineIndex"
                  type="button"
                  :disabled="!line"
                  @click="line && (resultHomeCanAccept(lineIndex) ? returnPlacedResultToHome(lineIndex) : selectResultTile(lineIndex))"
                  @pointerdown="line && lineHasResult(lineIndex) ? onDragStartResult(lineIndex, $event) : null"
                >
                  <span v-if="line && lineComputedResult(lineIndex).valid" class="numbers-derived-label">
                    {{ derivedLabel(lineIndex) }}
                  </span>
                  <span v-if="line && lineComputedResult(lineIndex).valid" class="numbers-slot-big">
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
                :disabled="gameState === 'pregame'"
                @click="opHomeCanAccept(op.value) ? returnPlacedOpToHome(op.value) : selectOp(op.value)"
                @pointerdown="onDragStartOp(op.value, $event)"
              >
                <span>{{ op.label }}</span>
              </button>
            </div>
          </div>

          <div class="numbers-bottom">
            <button
              type="button"
              :class="{ 'numbers-bottom-highlight': gameState === 'finished' }"
              :disabled="gameState === 'pregame'"
              @click="gameState === 'finished' ? showComputerSolution() : clearAllWorking()"
            >
              {{ gameState === 'finished' ? (showSolution ? 'Hide' : 'Solution') : 'Clear' }}
            </button>

            <button
              type="button"
              class="numbers-start-restore"
              :class="{ 'is-start': gameState === 'pregame' }"
              @click="restoreBest"
              :disabled="gameState !== 'pregame' && !bestSnapshot"
            >
              {{ restoreBestText }}
            </button>

            <button
              type="button"
              :disabled="!canCopy"
              :title="canCopy ? 'Copy result' : 'Finish game to copy'"
              @click="copyResult"
            >⧉</button>
          </div>

          <div v-if="showSolution && solutionText" id="solution-panel" class="numbers-solution-panel">
            <div class="numbers-label">Best Solution</div>
            <pre class="numbers-solution-text">{{ solutionText }}</pre>
          </div>
        </section>
      </div>
    </main>
  `,
}).mount("#app");