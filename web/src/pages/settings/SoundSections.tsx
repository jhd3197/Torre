// Sound (the main volume, effects and music) and Coach & voice (who speaks, how, and the voice packs).
import { useTranslation } from 'react-i18next';
import { effectsVolume, masterVolume, MOVE_SOUNDS, moveSoundStyle, MUSIC_DIPS, musicDip, muteAll, quietWhenHidden, SPEECH_SPEEDS, speechSpeed, voiceVolume } from '../../lib/audio';
import { backgroundMusic, musicLevel } from '../../lib/music';
import { soundEffects, useSounds } from '../../hooks/useSounds';
import { lessonSound, useNarration } from '../../hooks/useNarration';
import { captions } from '../../lib/captions';
import { COACH_VOICES, coachVoice } from '../../lib/voice';
import { rookyAutoplay } from '../../components/RookSpeaker';
import { usePacks, VoicePackList } from '../../components/VoicePacks';
import { quietCoach, reviewVoice } from '../../lib/settings';
import { anchorId, ChoiceRow, Choices, FlagSwitch, LevelRow, Row, Subheading, Switch } from './controls';

/** A small button that plays what a row changes. */
function SampleButton({ label, disabled, onClick }: { label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" className="button settings-sample" aria-label={label} title={label} disabled={disabled} onClick={onClick}>
      <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12"><path d="M3 1.5v9l7.5-4.5z" fill="currentColor" /></svg>
    </button>
  );
}

export function SoundSection() {
  const { t } = useTranslation('settings');
  const sounds = useSounds();
  const muted = muteAll.use();
  const effects = soundEffects.use() === 'on';
  const music = backgroundMusic.use() === 'on';
  // A capture, then the chime of a right answer: the two sounds heard most.
  const sample = () => { sounds.move('Nxe5'); setTimeout(sounds.correct, 350); };
  return (
    <>
      <FlagSwitch setting={muteAll} text="sound.mute" />
      <LevelRow setting={masterVolume} text="sound.master" disabled={muted} />
      <Subheading>{t('sound.effectsHeading')}</Subheading>
      <Switch id={anchorId('sound.effects')} label={t('sound.effects')} note={t('sound.effectsNote')} checked={effects}
        onChange={on => soundEffects.set(on ? 'on' : 'off')} />
      <LevelRow setting={effectsVolume} text="sound.effectsVolume" disabled={muted || !effects}>
        <SampleButton label={t('sound.sample')} disabled={muted || !effects} onClick={sample} />
      </LevelRow>
      <ChoiceRow setting={moveSoundStyle} values={MOVE_SOUNDS} text="sound.moveSound" group="sound.moveSounds" disabled={muted || !effects} />
      <Subheading>{t('sound.musicHeading')}</Subheading>
      <Switch id={anchorId('sound.music')} label={t('sound.music')} note={t('sound.musicNote')} checked={music}
        onChange={on => backgroundMusic.set(on ? 'on' : 'off')} />
      <LevelRow setting={musicLevel} text="sound.musicVolume" disabled={muted || !music} />
      <FlagSwitch setting={quietWhenHidden} text="sound.hidden" />
    </>
  );
}

export function VoiceSection() {
  const { t } = useTranslation('settings');
  // The sample is one of the coach's recorded puzzle praises, so an installed pack plays its real voice.
  const { t: lines } = useTranslation('voice');
  const narrator = useNarration();
  const packs = usePacks();
  const speaks = lessonSound.use() === 'on';
  const coach = coachVoice.use();
  const sample = () => narrator.speak({ narration: (lines('great', { returnObjects: true }) as string[])[0] });
  return (
    <>
      <Switch id={anchorId('voice.speaks')} label={t('voice.speaks')} note={t('voice.speaksNote')} checked={speaks}
        onChange={on => lessonSound.set(on ? 'on' : 'off')} />
      <Row id={anchorId('voice.coach')} label={t('voice.coach')} note={t('voice.coachNote')} disabled={!speaks}>
        <span className="settings-level">
          <Choices label={t('voice.coach')} options={COACH_VOICES.map(choice => [choice, t(`voice.${choice}`)])}
            value={coach} disabled={!speaks} onChange={choice => coachVoice.set(choice)} />
          <SampleButton label={t('voice.sample')} disabled={!speaks || narrator.speaking} onClick={sample} />
        </span>
      </Row>
      <ChoiceRow setting={speechSpeed} values={SPEECH_SPEEDS} text="voice.speed" group="voice.speeds" disabled={!speaks} />
      <LevelRow setting={voiceVolume} text="voice.volume" disabled={!speaks} />
      <ChoiceRow setting={musicDip} values={MUSIC_DIPS} text="voice.dip" group="voice.dips" disabled={!speaks} />
      <FlagSwitch setting={captions} text="voice.captions" disabled={!speaks} />
      <Subheading>{t('voice.whenHeading')}</Subheading>
      <Switch id={anchorId('voice.rooky')} label={t('voice.rooky')} note={t('voice.rookyNote')} checked={rookyAutoplay.use() === 'on'} disabled={!speaks}
        onChange={on => rookyAutoplay.set(on ? 'on' : 'off')} />
      <FlagSwitch setting={reviewVoice} text="voice.review" disabled={!speaks} />
      <FlagSwitch setting={quietCoach} text="voice.quiet" />
      <div className="settings-packs">
        <Subheading id={anchorId('voice.heading')}>{t('voice.heading')}</Subheading>
        <p className="settings-packs-note">{t('voice.note')}</p>
        <VoicePackList packs={packs} />
      </div>
    </>
  );
}
