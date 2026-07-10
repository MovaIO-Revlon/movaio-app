export type FieldMetadata = {
  key: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  subType?: 'string' | 'number' | 'boolean' | 'array' | 'object';
};

export function parseFieldsMeta(data: unknown[]): FieldMetadata[] {
  if (!data || !data.length) return [];

  const fields = new Map<
    string,
    { type: FieldMetadata['type']; subType?: FieldMetadata['subType'] }
  >();
  const firstItem = data[0];

  if (typeof firstItem !== 'object' || firstItem === null) return [];

  Object.keys(firstItem).forEach((key) => {
    const value = (firstItem as Record<string, unknown>)[key];
    const type = Array.isArray(value)
      ? 'array'
      : (typeof value as FieldMetadata['type']);
    fields.set(key, {
      type,
      subType:
        type === 'array'
          ? (typeof (value as unknown[])?.[0] as FieldMetadata['subType'])
          : undefined,
    });
  });

  return Array.from(fields).map(([key, { type, subType }]) => ({
    key,
    type,
    subType,
  }));
}

export function getPaths(
  obj: unknown,
  filterTypes?: FieldMetadata['type'][],
  subtype?: Omit<FieldMetadata['type'], 'array'>,
  maxDepth: number = -1,
  currentDepth: number = 0,
  currentPath: string = '',
): string[] {
  const paths: string[] = [];

  if (maxDepth !== -1 && currentDepth > maxDepth) {
    return paths;
  }

  const type = Array.isArray(obj)
    ? 'array'
    : (typeof obj as FieldMetadata['type']);

  let validSubtype =
    subtype && Array.isArray(obj) ? subtype === typeof obj?.[0] : true;

  if ((!filterTypes?.length || filterTypes.includes(type)) && validSubtype) {
    if (currentPath) {
      paths.push(currentPath);
    }
  }

  if (obj !== null && typeof obj === 'object') {
    if (maxDepth !== -1 && currentDepth >= maxDepth) {
      return paths;
    }

    if (Array.isArray(obj)) {
      obj.forEach((item, index) => {
        paths.push(
          ...getPaths(
            item,
            filterTypes,
            subtype,
            maxDepth,
            currentDepth + 1,
            `${currentPath}[${index}]`,
          ),
        );
      });
    } else {
      Object.keys(obj).forEach((key) => {
        const newPath = currentPath ? `${currentPath}.${key}` : key;
        paths.push(
          ...getPaths(
            (obj as Record<string, unknown>)[key],
            filterTypes,
            subtype,
            maxDepth,
            currentDepth + 1,
            newPath,
          ),
        );
      });
    }
  }

  return paths;
}

export function getValue<T = unknown>(
  obj: unknown,
  path: string,
): T | undefined {
  if (!path) return obj as T;

  return path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .reduce((acc: any, part: string) => acc?.[part], obj) as T | undefined;
}

export function setValue(obj: any, path: string, value: unknown): any {
  if (!path) return obj;

  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let current = obj;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (i === parts.length - 1) {
      current[part] = value;
    } else {
      const nextPart = parts[i + 1];
      const isNextPartNumber = /^\d+$/.test(nextPart);
      if (current[part] === undefined || typeof current[part] !== 'object') {
        current[part] = isNextPartNumber ? [] : {};
      }

      current = current[part];
    }
  }

  return obj;
}

export function renderTemplate(
  template: string,
  data: Record<string, unknown>,
): string {
  if (!template) return '';

  return template.replace(/\{\{(.*?)\}\}/g, (_, key) => {
    const trimmedKey = key.trim();
    const value = getValue(data, trimmedKey);
    return value != null ? String(value) : '';
  });
}
