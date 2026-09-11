import type {DepthOptions, MapKind} from './contracts';
export const downloadModelIds = ['image-small','video-small','alpha-fast','alpha-advanced','normal','appearance'] as const;
export type DownloadModelId = typeof downloadModelIds[number];
export interface ModelAvailability {
  id: DownloadModelId; name: string; ready: boolean; builtin: boolean;
  repo: string; revision: string; license: string; reason?: string;
}
export interface ModelCatalog {
  models: ModelAvailability[]; basicReady: boolean;
  busy?: {jobId: string; modelId: DownloadModelId};
}
export interface ModelDownloadProgress {
  jobId: string; modelId: DownloadModelId; stage: string;
  /** Normalized 0..1, matching runtime and depth progress. */
  progress: number; message: string;
}
export function requiredModelIds(options: Pick<DepthOptions,'processingMode'|'model'|'maps'>, maps: MapKind[] = options.maps): DownloadModelId[] {
  const result = new Set<DownloadModelId>();
  for (const map of maps) {
    if (map === 'depth' || (map === 'normal' && options.processingMode === 'fast')) result.add(options.model);
    else if (map === 'alpha') result.add(options.processingMode === 'advanced' ? 'alpha-advanced' : 'alpha-fast');
    else if (map === 'normal') result.add('normal');
    else if (options.processingMode === 'advanced' && ['basecolor','metallic','roughness','specular'].includes(map)) result.add('appearance');
  }
  return [...result];
}
