// A country's flag, drawn from country-flag-icons (only the flags listed here are bundled).
import { AE, AL, AM, AR, BR, CA, CL, CN, CO, DE, ES, FR, HU, IN, IT, JP, KR, MX, NL, NO, PA, PE, PH, PT, RS, RU, SE, SV, TR, UA, US, VE } from 'country-flag-icons/react/3x2';

const FLAGS = { AE, AL, AM, AR, BR, CA, CL, CN, CO, DE, ES, FR, HU, IN, IT, JP, KR, MX, NL, NO, PA, PE, PH, PT, RS, RU, SE, SV, TR, UA, US, VE };

export function Flag({ code, className = 'flag' }: { code: string; className?: string }) {
  const Drawn = FLAGS[code as keyof typeof FLAGS];
  return Drawn ? <Drawn className={className} aria-hidden /> : null;
}
