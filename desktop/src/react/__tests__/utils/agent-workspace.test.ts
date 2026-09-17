import { describe, expect, it } from 'vitest';
import {
  isSameWorkspacePath,
  resolveAgentWorkspace,
} from '../../utils/agent-workspace';

describe('agent workspace resolution', () => {
  it('prefers the server-resolved effective workspace over the explicit field', () => {
    expect(resolveAgentWorkspace({
      id: 'jarvis',
      name: 'Jarvis',
      yuan: 'jarvis',
      isPrimary: true,
      homeFolder: null,
      effectiveHomeFolder: '/home/test/Desktop/JARVIS-WorkSpace',
    })).toBe('/home/test/Desktop/JARVIS-WorkSpace');
  });

  it('treats Windows drive paths with slash and case differences as the same workspace', () => {
    expect(isSameWorkspacePath('C:\\Users\\Owner\\Work\\', 'c:/users/owner/work')).toBe(true);
  });

  it('treats Windows UNC paths case-insensitively', () => {
    expect(isSameWorkspacePath('\\\\Server\\Share\\Project', '//server/share/project/')).toBe(true);
  });
});
