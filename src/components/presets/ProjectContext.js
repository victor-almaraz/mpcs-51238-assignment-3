'use client';

import { createContext } from 'react';

/**
 * The project open in the editor, for components deep in a panel that need
 * the whole document (preset auditions apply a preset to a copy of it).
 * Null outside the editor.
 */
const ProjectContext = createContext(null);

export default ProjectContext;
