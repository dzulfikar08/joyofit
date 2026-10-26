import type { TemplateInput } from '../core/schema';
import { BADGE_TEMPLATES } from './badge';
import { LOAD_TEMPLATES } from './load';
import { PLAN_TEMPLATES } from './plan';
import { READY_TEMPLATES } from './ready';
import { RUN_TEMPLATES } from './run';
import { RUN_EXTRA_TEMPLATES } from './run-extra';
import { SLEEP_TEMPLATES } from './sleep';
import { SPORT_TEMPLATES } from './sport';
import { STRENGTH_TEMPLATES } from './strength';
import { THREADS_TEMPLATES } from './threads';
import { WATCH_TEMPLATES } from './watch';
import { WEEK_TEMPLATES } from './week';

/** Every built-in template as authored. `catalog.ts` parses and validates them once. */
export const TEMPLATE_INPUTS: TemplateInput[] = [
  ...RUN_TEMPLATES,
  ...RUN_EXTRA_TEMPLATES,
  ...SPORT_TEMPLATES,
  ...STRENGTH_TEMPLATES,
  ...SLEEP_TEMPLATES,
  ...READY_TEMPLATES,
  ...WATCH_TEMPLATES,
  ...WEEK_TEMPLATES,
  ...LOAD_TEMPLATES,
  ...PLAN_TEMPLATES,
  ...BADGE_TEMPLATES,
  ...THREADS_TEMPLATES,
];
