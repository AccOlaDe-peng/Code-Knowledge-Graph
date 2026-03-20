import { create } from "zustand";

export type PipelineStage = {
  key: string;
  label: string;
  description: string;
};

interface PipelineState {
  stages: PipelineStage[];
  total: number;
  loaded: boolean;
  setStages: (stages: PipelineStage[], total: number) => void;
}

export const usePipelineStore = create<PipelineState>()((set) => ({
  stages: [],
  total: 0,
  loaded: false,
  setStages: (stages, total) => set({ stages, total, loaded: true }),
}));
