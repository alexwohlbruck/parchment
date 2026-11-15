export declare const SDF_BUFFER: number
export declare const SDF_RADIUS: number
export declare const SDF_CUTOFF: number
export declare function sdfDistance(alpha: number): number
export declare function sdfCoverage(alpha: number): number
export declare function alphaToSdf(alpha: ArrayLike<number>, width: number, height: number): Uint8Array
