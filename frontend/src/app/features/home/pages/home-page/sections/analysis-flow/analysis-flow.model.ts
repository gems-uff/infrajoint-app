export type StepPhase = 'prep' | 'cap' | 'cli';

export interface StepDetail {
  label: string;
  value: string;
}

export interface CapturePhase {
  title: string;
  description: string;
}

export interface PatientGroup {
  letter: 'A' | 'B' | 'C';
  description: string;
}

export interface CameraParam {
  key: string;
  value: string;
}

export interface ProgressBar {
  label: string;
  phases: { label: string; value: number }[];
}

export interface ProtocolStep {
  id: number;
  phase: StepPhase;
  title: string;
  subtitle: string;
  details: StepDetail[];
  keyPoints: string[];
  note: string;
  groups?: PatientGroup[];
  cameraParams?: CameraParam[];
  capturePhases?: CapturePhase[];
  progress?: ProgressBar;
}
