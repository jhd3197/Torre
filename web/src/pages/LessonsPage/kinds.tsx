// Every step kind the lesson page can show, in one place: the view that runs it and the section
// (Learn / Watch / Try it / Quiz) it is labelled with. Whether a kind is scored is the server's
// call (lessons.py is_scored), sent on each step as `scored`.
//
// Adding a kind: its parser in lessons.py, its type in types.ts, one entry here.
import type { ComponentType } from 'react';
import type { LessonStep } from '../../types';
import { ChooseView } from './ChooseView';
import { DrillView } from './DrillView';
import { ExplainView } from './ExplainView';
import { GuessView } from './GuessView';
import { PlayView } from './PlayView';
import { ReelView } from './ReelView';
import type { ScoredProps } from './StepLayout';

export type Section = 'learn' | 'watch' | 'try' | 'quiz';
type Kind = LessonStep['kind'];
// The step type whose `kind` includes K (a drill's kind is a union, so Extract would miss it).
type Match<S, K> = S extends { kind: infer SK } ? (K extends SK ? S : never) : never;
type StepOf<K extends Kind> = Match<LessonStep, K>;

interface KindEntry<K extends Kind> {
  view: ComponentType<ScoredProps<StepOf<K>>>;
  section: Section | ((step: StepOf<K>) => Section);
}

const STEP_KINDS: { [K in Kind]: KindEntry<K> } = {
  explain: { view: ExplainView, section: 'learn' },
  reel: { view: ReelView, section: 'watch' },
  play: { view: PlayView, section: 'try' },
  guess: { view: GuessView, section: 'try' },
  choose: { view: ChooseView, section: 'quiz' },
  stars: { view: DrillView, section: step => (step.watch ? 'watch' : 'try') },
  reach: { view: DrillView, section: 'try' },
  capture: { view: DrillView, section: 'try' },
  count: { view: DrillView, section: 'quiz' },
};

const entryOf = (step: LessonStep) => STEP_KINDS[step.kind] as unknown as KindEntry<Kind>;

/** What kind of moment a step is: read, watch, do, or answer. */
export function sectionOf(step: LessonStep): Section {
  const { section } = entryOf(step);
  return typeof section === 'function' ? section(step as never) : section;
}

/** The step's own view. */
export function StepView(props: ScoredProps<LessonStep>) {
  const View = entryOf(props.step).view as ComponentType<ScoredProps<LessonStep>>;
  return <View {...props} />;
}
