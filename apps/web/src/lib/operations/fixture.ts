/**
 * @deprecated There is no recorded operations data. This alias reads as an empty snapshot so the remaining importers
 * show nothing rather than recorded stand-ins; read live health with `useOperationsSnapshot`
 * (components/operations/useOperations.ts) or `buildOperationsSnapshot` (lib/operations/model.ts) and delete this file.
 */
export { EMPTY_OPERATIONS_SNAPSHOT as OPERATIONS_FIXTURE } from "./model";
