// How loud everything is: one main volume and a mute over the three sources (sound effects,
// background music, the coach's voice), each with its own level. Every source multiplies its own
// level by the main one, so the main slider moves them all together.
import { createFlag, createLevel, createSetting } from './settings';

export const masterVolume = createLevel('chess-jd-master-volume', 100);
export const muteAll = createFlag('chess-jd-mute', false);
export const effectsVolume = createLevel('chess-jd-effects-volume', 100);
export const voiceVolume = createLevel('chess-jd-voice-volume', 100);

/** The sound of a piece landing: a knock on wood, a soft tap, or nothing (the other effects still play). */
export const MOVE_SOUNDS = ['wood', 'soft', 'none'] as const;
export type MoveSoundStyle = typeof MOVE_SOUNDS[number];
export const moveSoundStyle = createSetting<MoveSoundStyle>('chess-jd-move-sound', 'wood', MOVE_SOUNDS);

/** How fast the coach talks; recordings and the browser's voice both follow it. */
export const SPEECH_SPEEDS = ['slow', 'normal', 'fast'] as const;
export type SpeechSpeed = typeof SPEECH_SPEEDS[number];
export const speechSpeed = createSetting<SpeechSpeed>('chess-jd-speech-speed', 'normal', SPEECH_SPEEDS);
const SPEED: Record<SpeechSpeed, number> = { slow: 0.85, normal: 1, fast: 1.2 };
export const speechRate = () => SPEED[speechSpeed.get()];

/** How far the music drops while the coach talks: not at all, some, or a lot (the usual). */
export const MUSIC_DIPS = ['none', 'some', 'lots'] as const;
export type MusicDip = typeof MUSIC_DIPS[number];
export const musicDip = createSetting<MusicDip>('chess-jd-music-dip', 'lots', MUSIC_DIPS);
const DIP: Record<MusicDip, number> = { none: 1, some: 0.6, lots: 0.3 };
/** The share of the music's level kept under the coach's voice. */
export const duckedShare = () => DIP[musicDip.get()];

/** Quiet while the tab is in the background: the music pauses and effects stay silent. */
export const quietWhenHidden = createFlag('chess-jd-quiet-hidden', true);

/** The main volume as a gain from 0 to 1, zero while muted. */
export const mainGain = () => (muteAll.get() ? 0 : masterVolume.get() / 100);
/** A source's gain: its own level times the main volume. */
export const effectsGain = () => mainGain() * effectsVolume.get() / 100;
export const voiceGain = () => mainGain() * voiceVolume.get() / 100;
/** Whether sound should hold off because the tab is hidden. */
export const hiddenQuiet = () => quietWhenHidden.get() && typeof document !== 'undefined' && document.hidden;
