import { createHome } from './index';

const KnockoutHome = createHome({
  defaults: { knockout: true },
  knockoutLocked: true,
  variant: 'knockout',
});

export default KnockoutHome;
