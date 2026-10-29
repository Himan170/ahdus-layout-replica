import smallOffice from './small-office.json';
import factoryFloor from './factory-floor.json';
import clinic from './clinic.json';

export const LAYOUT_TEMPLATES = [
  {
    id: 'small-office',
    name: 'Small Office',
    description: 'Reception, open workstations, private offices, meeting room, pantry and storage.',
    layout: smallOffice,
  },
  {
    id: 'factory-floor',
    name: 'Factory Floor',
    description: 'Production machinery, materials and finished-goods storage, quality and dispatch.',
    layout: factoryFloor,
  },
  {
    id: 'clinic',
    name: 'Clinic',
    description: 'Reception and waiting, consultation and treatment rooms, staff, storage and restroom.',
    layout: clinic,
  },
];
