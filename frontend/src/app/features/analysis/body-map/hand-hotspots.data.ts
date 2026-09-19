import { BodySide, JointId } from './body-map.model';

/**
 * Detailed hand views. Each hand image (direita.png / esquerda.png) highlights
 * its 11 joints in red; the coordinates below — percentages of the image — were
 * measured from those red markers so the hotspots overlay them exactly.
 */

export interface HandJointHotspot {
  readonly jointId: JointId;
  readonly xPct: number;
  readonly yPct: number;
}

export interface HandView {
  readonly side: BodySide;
  readonly image: string;
  readonly hotspots: readonly HandJointHotspot[];
}

/** Width / height ratio of the hand images (1306 × 1204). */
export const HAND_IMAGE_ASPECT = 1306 / 1204;

export const HAND_VIEWS: Record<BodySide, HandView> = {
  right: {
    side: 'right',
    image: 'assets/images/direita.png',
    hotspots: [
      { jointId: 'RIGHT_WRIST', xPct: 49.07, yPct: 78.1 },
      { jointId: 'RIGHT_MCP_1', xPct: 28.16, yPct: 60.02 },
      { jointId: 'RIGHT_PIP_1', xPct: 22.78, yPct: 50.43 },
      { jointId: 'RIGHT_MCP_2', xPct: 40.2, yPct: 40.45 },
      { jointId: 'RIGHT_PIP_2', xPct: 37.42, yPct: 23.45 },
      { jointId: 'RIGHT_MCP_3', xPct: 49.57, yPct: 39.53 },
      { jointId: 'RIGHT_PIP_3', xPct: 49.6, yPct: 20.87 },
      { jointId: 'RIGHT_MCP_4', xPct: 58.81, yPct: 40.41 },
      { jointId: 'RIGHT_PIP_4', xPct: 60.58, yPct: 23.01 },
      { jointId: 'RIGHT_MCP_5', xPct: 67.75, yPct: 43.53 },
      { jointId: 'RIGHT_PIP_5', xPct: 71.46, yPct: 32.27 },
    ],
  },
  left: {
    side: 'left',
    image: 'assets/images/esquerda.png',
    hotspots: [
      { jointId: 'LEFT_WRIST', xPct: 50.85, yPct: 78.1 },
      { jointId: 'LEFT_MCP_1', xPct: 71.77, yPct: 60.02 },
      { jointId: 'LEFT_PIP_1', xPct: 77.15, yPct: 50.43 },
      { jointId: 'LEFT_MCP_2', xPct: 59.73, yPct: 40.45 },
      { jointId: 'LEFT_PIP_2', xPct: 62.5, yPct: 23.45 },
      { jointId: 'LEFT_MCP_3', xPct: 50.36, yPct: 39.53 },
      { jointId: 'LEFT_PIP_3', xPct: 50.33, yPct: 20.87 },
      { jointId: 'LEFT_MCP_4', xPct: 41.12, yPct: 40.41 },
      { jointId: 'LEFT_PIP_4', xPct: 39.35, yPct: 23.01 },
      { jointId: 'LEFT_MCP_5', xPct: 32.17, yPct: 43.53 },
      { jointId: 'LEFT_PIP_5', xPct: 28.46, yPct: 32.27 },
    ],
  },
};
