/**
 * Wizard state for the Domain Picker page.
 *
 * Tracks current step + completion set + threshold/preset draft so the user
 * can jump back to any completed step and pick up where they left off.
 *
 * Persistence: a slim snapshot (step + completed + preset + thresholds + weights
 * + topN) is mirrored to localStorage. The parsed CSV row array is NOT persisted
 * — it can be several MB and would trip the ~5MB localStorage quota. User
 * re-uploads on browser refresh, which is by design (confirmed with user).
 */

import {
  DEFAULT_THRESHOLDS,
  DEFAULT_WEIGHTS,
  THRESHOLD_PRESETS,
  type PickerThresholds,
  type PickerWeights,
  type PresetName,
} from "@/lib/picker-csv";

export type WizardStep = 1 | 2 | 3 | 4;

export const WIZARD_STEPS: { id: WizardStep; label: string }[] = [
  { id: 1, label: "Upload Spamzilla" },
  { id: 2, label: "Danh sách domain" },
  { id: 3, label: "Upload Result" },
  { id: 4, label: "Wayback check" },
];

export interface WizardState {
  step: WizardStep;
  completed: Set<WizardStep>;
  presetName: PresetName;
  thresholds: PickerThresholds;
  weights: PickerWeights;
  topN: number;
}

export type WizardAction =
  | { type: "goto"; step: WizardStep }
  | { type: "complete"; step: WizardStep }
  | { type: "advance"; from: WizardStep }
  | { type: "applyPreset"; name: Exclude<PresetName, "custom"> }
  | { type: "setThresholds"; thresholds: PickerThresholds; presetName: PresetName }
  | { type: "setWeights"; weights: PickerWeights }
  | { type: "setTopN"; topN: number }
  | { type: "resetConfig" }
  | { type: "hydrate"; snapshot: Partial<WizardState> };

export function initialWizardState(): WizardState {
  return {
    step: 1,
    completed: new Set(),
    // Không lọc — mọi domain đều qua (đã bỏ preset + tinh chỉnh thủ công).
    presetName: "none",
    thresholds: { ...THRESHOLD_PRESETS.none },
    weights: { ...DEFAULT_WEIGHTS },
    topN: 50,
  };
}

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "goto": {
      // Allow back-nav to any earlier step, and forward-nav only to completed ones.
      const reachable =
        action.step <= state.step || state.completed.has(action.step);
      if (!reachable) return state;
      return { ...state, step: action.step };
    }
    case "complete": {
      if (state.completed.has(action.step)) return state;
      const next = new Set(state.completed);
      next.add(action.step);
      return { ...state, completed: next };
    }
    case "advance": {
      const next = new Set(state.completed);
      next.add(action.from);
      const nextStep = Math.min(4, action.from + 1) as WizardStep;
      return { ...state, completed: next, step: nextStep };
    }
    case "applyPreset": {
      const t = THRESHOLD_PRESETS[action.name];
      return { ...state, presetName: action.name, thresholds: { ...t } };
    }
    case "setThresholds":
      return { ...state, thresholds: action.thresholds, presetName: action.presetName };
    case "setWeights":
      return { ...state, weights: action.weights };
    case "setTopN":
      return { ...state, topN: action.topN };
    case "resetConfig":
      return {
        ...state,
        presetName: "balanced",
        thresholds: { ...DEFAULT_THRESHOLDS },
        weights: { ...DEFAULT_WEIGHTS },
        topN: 50,
      };
    case "hydrate":
      return { ...state, ...action.snapshot };
  }
}

// ─── localStorage persistence ─────────────────────────────────────────────────

const STORAGE_KEY = "domain-picker.wizard.v1";

interface Snapshot {
  step: WizardStep;
  completed: WizardStep[];
  presetName: PresetName;
  thresholds: PickerThresholds;
  weights: PickerWeights;
  topN: number;
}

export function saveSnapshot(state: WizardState): void {
  if (typeof window === "undefined") return;
  try {
    const snap: Snapshot = {
      step: state.step,
      completed: Array.from(state.completed),
      presetName: state.presetName,
      thresholds: state.thresholds,
      weights: state.weights,
      topN: state.topN,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snap));
  } catch {
    /* quota or disabled — ignore */
  }
}

export function loadSnapshot(): Partial<WizardState> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const snap = JSON.parse(raw) as Snapshot;
    return {
      step: snap.step,
      completed: new Set(snap.completed),
      presetName: snap.presetName,
      thresholds: snap.thresholds,
      weights: snap.weights,
      topN: snap.topN,
    };
  } catch {
    return null;
  }
}
