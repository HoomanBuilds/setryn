import { observationRange } from "@/lib/terminal/discovery";
import { POSITIONS } from "./model";

const OBSERVATION = observationRange(POSITIONS.map((position) => position.market));

export const MARK_AGE =
  OBSERVATION.min === OBSERVATION.max
    ? `marks observed ${OBSERVATION.min}s ago`
    : `marks observed ${OBSERVATION.min}s to ${OBSERVATION.max}s ago`;

export const PROVENANCE = [`${POSITIONS.length} open positions`, "preview fixture", MARK_AGE];
