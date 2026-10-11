// Phone widths: the app turns into an app there, with a tab bar and screens laid out for one thumb.
import { useMedia } from '../components/rail/useRail';

/** The same width as the stylesheets' `down(md)`. */
export const PHONE_QUERY = '(max-width: 740px)';

export const usePhone = () => useMedia(PHONE_QUERY);
