import { ashby } from './ats/ashby';
import { greenhouse } from './ats/greenhouse';
import { workable } from './ats/workable';

export const sources = {
  greenhouse: greenhouse(),
  ashby: ashby(),
  workable: workable(),
};
