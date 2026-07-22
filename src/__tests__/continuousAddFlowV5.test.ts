import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const addItemsSource = appSource.slice(
  appSource.indexOf('function AddItemsPage'),
  appSource.indexOf('function StoresPage'),
);

describe('continuous collection add flow', () => {
  it('resets the add form in place after either successful save path', () => {
    expect(addItemsSource).not.toContain("navigate('/collection')");
    expect(addItemsSource.match(/reset\(\);/g)).toHaveLength(2);
  });

  it('keeps duplicate quantity additions in the same save flow', () => {
    expect(addItemsSource).toContain('onClick={() => void save(true)}');
  });
});
