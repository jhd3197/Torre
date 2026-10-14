// Torre's AI, as the interface sees it (torre/ai, /api/ai): the providers and their models, which
// model each feature uses, and whether a feature can ask one. Settings > AI, the coach and the
// explanations all read it from here.
import { useEffect, useState } from 'react';
import { api } from './api';

export type AiEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type AiFeature = 'coach' | 'explain';
export const AI_FEATURES: AiFeature[] = ['coach', 'explain'];
/** cloud: an API key; local: a server on this computer; login: a coding CLI you are signed in to. */
export type AiProviderKind = 'login' | 'local' | 'cloud';
export type AiProviderDetail = 'signed_in' | 'not_installed' | 'running' | 'no_models' | 'not_running' | 'key_saved' | 'needs_key';

export interface AiModel {
  id: string;
  name: string;
  provider: string;
  released: string;
  /** The efforts it takes; empty when it does not reason (or the catalogue does not say). */
  efforts: AiEffort[];
  /** Dollars per million tokens. */
  cost: { input: number; output: number | null } | null;
}

export interface AiProvider {
  id: string;
  name: string;
  kind: AiProviderKind;
  ready: boolean;
  detail: AiProviderDetail;
  url: string | null;
  /** Cloud only: the saved key's last characters, and whether it was saved or comes from the environment. */
  key: { hint: string; source: 'saved' | 'environment' } | null;
  models: AiModel[];
}

/** auto: a model served on this computer, picked because none was chosen. */
export type AiSource = 'feature' | 'default' | 'auto' | null;

export interface AiView {
  hosted: boolean;
  prompture: { installed: boolean; version: string | null; install: { running: boolean; error: string | null; done: boolean } };
  desk: { running: boolean; version: string | null };
  providers: AiProvider[];
  settings: { model: string | null; features: Partial<Record<AiFeature, string>>; setup_seen: boolean };
  /** The model in use by default, and where it came from. */
  model: string | null;
  source: AiSource;
  features: Record<AiFeature, { model: string | null; source: AiSource }>;
  /** What the catalogue knows about each model in use. */
  models: Record<string, AiModel>;
  /** After saving a key: what the provider said about it. */
  check?: 'valid' | 'unverified' | 'unchecked' | null;
}

export interface AiStatus {
  available: boolean;
  model: string | null;
  source: AiSource;
  reason: 'prompture_missing' | 'no_model' | null;
  setup_seen: boolean;
  hosted: boolean;
}

export interface AiTest { ok: boolean; seconds: number; reply?: string; error?: string }
export interface AiUsage { model: string; calls: number; tokens: number; cost: number; last_used: string }

export const loadAi = () => api<AiView>('api/ai');
export const saveAiSettings = (changes: { model?: string | null; features?: Partial<Record<AiFeature, string | null>> }) =>
  api<AiView>('api/ai/settings', changes);
export const saveAiKey = (provider: string, key: string) => api<AiView>('api/ai/key', { provider, key });
export const testAiModel = (model: string) => api<AiTest>('api/ai/test', { model });
export const providerModels = (provider: string) =>
  api<{ models: AiModel[]; error?: 'key' }>(`api/ai/models?provider=${encodeURIComponent(provider)}`);

/** A model's name without its provider: "claude/claude-fable-5-1" -> "claude-fable-5-1". */
export const bareName = (model: string) => model.slice(model.indexOf('/') + 1);
/** The name to show for a model: the catalogue's, else the bare name. */
export const modelName = (model: string, known?: Record<string, AiModel>) => known?.[model]?.name ?? bareName(model);
/** A price per million tokens, in and out: "$2 / $10". */
export const priceText = (cost: AiModel['cost']) => (cost ? `$${cost.input} / $${cost.output ?? '?'}` : null);

const statuses = new Map<string, Promise<AiStatus | null>>();
/** Whether a feature can ask a model (Prompture and a model); asked once per page load and feature. */
export function useAiStatus(feature?: AiFeature) {
  const [status, setStatus] = useState<AiStatus | null>(null);
  useEffect(() => {
    let live = true;
    const key = feature ?? '';
    if (!statuses.has(key)) statuses.set(key, api<AiStatus>(`api/ai/status${feature ? `?feature=${feature}` : ''}`).catch(() => null));
    void statuses.get(key)!.then(s => { if (live) setStatus(s); });
    return () => { live = false; };
  }, [feature]);
  return status;
}
/** Forget the answers (tests, and after the settings change). */
export const resetAiStatus = () => statuses.clear();
