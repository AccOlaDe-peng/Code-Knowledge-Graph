import { create } from "zustand";

export type PipelineStage = {
  key: string;
  label: string;
  description: string;
};

interface PipelineState {
  stages: PipelineStage[];
  graphifyStages: PipelineStage[];
  total: number;
  loaded: boolean;
  mode: "pipeline" | "graphify";
  setStages: (stages: PipelineStage[], total: number, mode: "pipeline" | "graphify") => void;
}

export const usePipelineStore = create<PipelineState>()((set) => ({
  stages: [],
  graphifyStages: [],
  total: 0,
  loaded: false,
  mode: "pipeline",
  setStages: (stages, total, mode) =>
    set(() => ({
      ...(mode === "pipeline"
        ? { stages, total, loaded: true, mode }
        : { graphifyStages: stages, total, loaded: true, mode }),
    })),
}));
