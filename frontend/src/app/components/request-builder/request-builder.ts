import {
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  FormArray,
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
} from '@angular/forms';
import { CustomFieldComponent } from './custom-field';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormError } from '../form-error/form-error';
import { V } from '../../utils';
import { JsonPipe } from '@angular/common';
import {
  IFunctionJson,
  IGroup,
  IProperty,
  IRequest,
  ISecurityScheme,
} from '../../types';

type TSecurityScheme = FormGroup<{
  [J in keyof ISecurityScheme]: FormControl<ISecurityScheme[J]>;
}>;

type TPropertyForm = {
  [M in keyof IProperty]: FormControl<IProperty[M]>;
};

type TGroupForm = {
  [M in keyof Omit<IGroup, 'properties'>]: FormControl<IGroup[M]>;
} & {
  properties: FormArray<FormGroup<TPropertyForm>>;
};

type TRequestForm = {
  [K in keyof Omit<IRequest, 'securityScheme' | 'groups'>]: FormControl<
    IRequest[K]
  >;
} & {
  securityScheme: TSecurityScheme;
  groups: FormArray<FormGroup<TGroupForm>>;
};

const DEFAULT_SCHEMA: IFunctionJson = {
  name: 'TOOL__ACTION_NAME',
  description: 'Action Description',
  tags: ['TAG1', 'TAG2', 'TAG3'],
  visibility: 'public',
  active: true,
  protocol: 'rest',
  protocol_data: {
    method: 'GET',
    path: '/action-path',
    server_url: 'https://action-endpoint.com',
  },
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'object',
        description: '',
        properties: {
          search: {
            type: 'string',
            description: 'string value to search',
          },
        },
        required: [],
        visible: ['search'],
        additionalProperties: false,
      },
    },
    required: [],
    visible: ['query'],
    additionalProperties: false,
  },
};
@Component({
  selector: 'request-builder',
  standalone: true,
  imports: [ReactiveFormsModule, CustomFieldComponent, FormError, JsonPipe],
  templateUrl: './request-builder.html',
  styleUrl: './request-builder.css',
})
export class RequestBuilderComponent {
  private fb = inject(FormBuilder);

  submit = output<IFunctionJson>();
  activeTab = signal<'builder' | 'json' | 'test'>('builder');
  excludeNames = input<string[]>([]);
  initialSchema = input<IFunctionJson | null>(null);
  jsonError = signal<string | null>(null);
  jsonInput = this.fb.control('', { nonNullable: true });

  testVariablesInput = this.fb.control(
    '{\n  "AIPOLABS_GMAIL_CLIENT_ID": "mock-client-123"\n}',
    { nonNullable: true },
  );
  isTesting = signal(false);
  testResponse = signal<any>(null);

  visibilityOptions = [
    { label: 'public', value: 'public' },
    { label: 'private', value: 'private' },
    { label: 'internal', value: 'internal' },
  ];
  protocolOptions = [
    { label: 'rest', value: 'rest' },
    // { label: 'graphql', value: 'graphql' },
    // { label: 'grpc', value: 'grpc' },
  ];
  authSchemeOptions = [
    { label: 'None / Inherit', value: 'none' },
    { label: 'API Key', value: 'api_key' },
    { label: 'OAuth 2.0', value: 'oauth2' },
  ];
  methodOptions = [
    'GET',
    'POST',
    'PUT',
    'PATCH',
    'DELETE',
    'HEAD',
    'OPTIONS',
  ].map((m) => ({ label: m, value: m }));
  typeOptions = [
    'string',
    'integer',
    'number',
    'boolean',
    'array',
    'object',
  ].map((t) => ({ label: t, value: t }));

  form = this.fb.nonNullable.group<TRequestForm>({
    name: this.fb.nonNullable.control(
      'TOOL__ACTION_NAME',
      V.string('Action name')
        .required()
        .test('duplicate', 'Name is already used', (val) => {
          const n = this.excludeNames();
          if (!val || !n.length) return false;

          return !n.includes(val);
        })
        .build(),
    ),
    description: this.fb.nonNullable.control(
      'Action Description',
      V.string('Description')
        .max(300, 'Description should be under 300 characters')
        .build(),
    ),
    tags: this.fb.nonNullable.control('onedrive, files, folders'),
    visibility: this.fb.nonNullable.control('public'),
    active: this.fb.nonNullable.control(true),
    protocol: this.fb.nonNullable.control('rest'),
    method: this.fb.nonNullable.control('GET'),
    serverUrl: this.fb.nonNullable.control(
      'https://action-endpoint.com',
      V.string('Server URL')
        .required()
        .url('Valid HTTP/HTTPS URL required')
        .build(),
    ),
    path: this.fb.nonNullable.control(
      '/action-path',
      V.string('Path')
        .required()
        .matches(/^\//, 'Must begin with a forward slash (/)')
        .build(),
    ),
    paramsAdditional: this.fb.nonNullable.control(false),
    securityScheme: this.fb.nonNullable.group({
      type: this.fb.nonNullable.control('none'),
      location: this.fb.nonNullable.control('header'),
      name: this.fb.nonNullable.control('Authorization'),
      prefix: this.fb.nonNullable.control('Bearer'),
      clientId: this.fb.nonNullable.control(''),
      clientSecret: this.fb.nonNullable.control(''),
      scope: this.fb.nonNullable.control(''),
      authorizeUrl: this.fb.nonNullable.control(''),
      accessTokenUrl: this.fb.nonNullable.control(''),
      refreshTokenUrl: this.fb.nonNullable.control(''),
    }),
    groups: this.fb.array([
      this.createGroup('query', 'Query parameters', true, true, [
        this.createProperty('search', 'string', 'string value to search'),
      ]),
      this.createGroup('path', 'Path parameters', true, false, []),
      this.createGroup('headers', 'Headers', true, false, []),
      this.createGroup('body', 'Body', true, false, []),
    ]),
  });

  formValue = toSignal(this.form.valueChanges, {
    initialValue: this.form.value,
  });

  constructor() {
    effect(() => {
      const initial = this.initialSchema();
      if (initial) {
        this.jsonInput.setValue(JSON.stringify(initial), { emitEvent: false });
        this.applyJson(initial);
      }
    });

    effect(() => {
      const schema = this.generatedSchema();
      if (this.jsonInput.value !== schema && !this.jsonError()) {
        this.jsonInput.setValue(schema, { emitEvent: false });
      }
    });
  }

  async runTest() {
    this.isTesting.set(true);
    this.testResponse.set(null);

    const schemaPayload = this.generatedSchema();
    const variablesPayload = this.testVariablesInput.value;

    try {
      // Basic JSON validation for variables before sending
      JSON.parse(variablesPayload);

      // TODO: Replace this mock block with your actual Python Backend API call
      // Example: await this.http.post('/api/test-execution', { schema: schemaPayload, variables: variablesPayload }).toPromise();

      setTimeout(() => {
        this.testResponse.set({
          req: {
            method: this.form.controls.method.value,
            url: `${this.form.controls.serverUrl.value}${this.form.controls.path.value}`,
            headers: {
              Authorization: 'Bearer **********',
              'Content-Type': 'application/json',
            },
          },
          res: {
            status: 200,
            time: 142,
            body: {
              success: true,
              message: 'Mock response from Python backend proxy.',
            },
          },
        });
        this.isTesting.set(false);
      }, 800);
    } catch (e) {
      this.isTesting.set(false);
      alert('Invalid JSON in Test Variables area. Please fix before running.');
    }
  }

  get groups() {
    return this.form.get('groups') as FormArray;
  }

  getProperties(groupIndex: number) {
    return this.groups.at(groupIndex).get('properties') as FormArray;
  }

  private createGroup(
    key: string,
    label: string,
    locked: boolean,
    enabled: boolean,
    properties: FormGroup[] = [],
  ) {
    return this.fb.nonNullable.group<TGroupForm>({
      key: this.fb.nonNullable.control(key),
      label: this.fb.nonNullable.control(label),
      locked: this.fb.nonNullable.control(locked),
      enabled: this.fb.nonNullable.control(enabled),
      description: this.fb.nonNullable.control(''),
      required: this.fb.nonNullable.control(false),
      visible: this.fb.nonNullable.control(true),
      additionalProperties: this.fb.nonNullable.control(false),
      properties: this.fb.array(properties),
    });
  }

  private createProperty(name = '', type = 'string', description = '') {
    return this.fb.nonNullable.group<TPropertyForm>({
      name: this.fb.nonNullable.control(
        name,
        V.string('Parameter name')
          .required()
          .noSpaces('Spaces are not allowed')
          .build(),
      ),
      type: this.fb.nonNullable.control(
        type,
        V.string('Type').required().build(),
      ),
      description: this.fb.nonNullable.control(description),
      required: this.fb.nonNullable.control(false),
      visible: this.fb.nonNullable.control(true),
    });
  }

  addProperty(groupIndex: number) {
    this.getProperties(groupIndex).push(this.createProperty());
    this.groups.at(groupIndex).patchValue({ enabled: true });
  }

  removeProperty(groupIndex: number, propIndex: number) {
    this.getProperties(groupIndex).removeAt(propIndex);
  }

  addGroup(key: string) {
    if (!key.trim()) return;
    this.groups.push(
      this.createGroup(key.trim(), 'Custom section', false, true, []),
    );
  }

  removeGroup(index: number) {
    this.groups.removeAt(index);
  }

  applyJson(parsedJson?: object) {
    if (!this.jsonInput.value.trim()) return;
    try {
      const parsed = parsedJson || JSON.parse(this.jsonInput.value);
      this.jsonError.set(null);

      const securitySchemes = parsed.security_schemes;
      let authType = 'none';
      let authData: any = {};
      if (securitySchemes) {
        if (securitySchemes.oauth2) {
          authType = 'oauth2';
          authData = securitySchemes.oauth2;
        } else if (securitySchemes.api_key) {
          authType = 'api_key';
          authData = securitySchemes.api_key;
        }
      }

      this.form.patchValue(
        {
          name: parsed.name || '',
          description: parsed.description || '',
          tags: Array.isArray(parsed.tags) ? parsed.tags.join(', ') : '',
          visibility: parsed.visibility || 'public',
          active: parsed.active ?? true,
          protocol: parsed.protocol || 'rest',
          method: parsed.protocol_data?.method || 'GET',
          serverUrl: parsed.protocol_data?.server_url || '',
          path: parsed.protocol_data?.path || '',
          paramsAdditional: parsed.parameters?.additionalProperties || false,
          securityScheme: {
            type: authType,
            location: authData.location || 'header',
            name: authData.name || '',
            prefix: authData.prefix || '',
            clientId: authData.client_id || '',
            clientSecret: authData.client_secret || '',
            scope: authData.scope || '',
            authorizeUrl: authData.authorize_url || '',
            accessTokenUrl: authData.access_token_url || '',
            refreshTokenUrl: authData.refresh_token_url || '',
          },
        },
        { emitEvent: false },
      );

      this.groups.clear({ emitEvent: false });
      const incomingGroups = parsed.parameters?.properties || {};
      const visibleGroups = parsed.parameters?.visible || [];
      const requiredGroups = parsed.parameters?.required || [];
      const defaultGroupKeys = ['query', 'path', 'headers', 'body'];
      const groupsToProcess = new Set([
        ...defaultGroupKeys,
        ...Object.keys(incomingGroups),
      ]);

      groupsToProcess.forEach((groupKey) => {
        const groupData = incomingGroups[groupKey];
        const isLocked = defaultGroupKeys.includes(groupKey);
        const propControls: FormGroup[] = [];
        if (groupData && groupData.properties) {
          const reqProps = groupData.required || [];
          const visProps = groupData.visible || [];
          Object.entries(groupData.properties).forEach(
            ([propName, propDef]: [string, any]) => {
              const pGroup = this.createProperty(
                propName,
                propDef.type || 'string',
                propDef.description || '',
              );
              pGroup.patchValue(
                {
                  required: reqProps.includes(propName),
                  visible: visProps.includes(propName),
                },
                { emitEvent: false },
              );
              propControls.push(pGroup);
            },
          );
        }
        const newGroup = this.createGroup(
          groupKey,
          isLocked
            ? groupKey.charAt(0).toUpperCase() +
                groupKey.slice(1) +
                ' parameters'
            : 'Custom section',
          isLocked,
          !!Object.keys(groupData?.properties || {})?.length,
          propControls,
        );
        if (groupData) {
          newGroup.patchValue(
            {
              description: groupData.description || '',
              additionalProperties: groupData.additionalProperties || false,
              required: requiredGroups.includes(groupKey),
              visible: visibleGroups.includes(groupKey),
            },
            { emitEvent: false },
          );
        }
        this.groups.push(newGroup, { emitEvent: false });
      });
      this.form.updateValueAndValidity();
    } catch (err) {
      this.jsonError.set(
        'Malformed JSON payload. Reverting to last known good state.',
      );
    }
  }

  generatedSchema = computed(() => {
    const val = this.formValue();
    const tags = val.tags
      ? val.tags
          .split(',')
          .map((t: string) => t.trim())
          .filter(Boolean)
      : [];
    const properties: any = {};
    const requiredGroups: string[] = [];
    const visibleGroups: string[] = [];

    (val.groups || []).forEach((g: any) => {
      if (!g || !g?.enabled) return;
      const gProps: any = {};
      const gReq: string[] = [];
      const gVis: string[] = [];
      (g.properties || []).forEach((p: any) => {
        if (!p.name) return;
        gProps[p.name] = { type: p.type };
        if (p.description) gProps[p.name].description = p.description;
        if (p.required) gReq.push(p.name);
        if (p.visible) gVis.push(p.name);
      });
      if (!g.key) return;
      properties[g.key] = {
        type: 'object',
        description: g.description || '',
        properties: gProps,
        required: gReq,
        visible: gVis,
        additionalProperties: g.additionalProperties,
      };
      if (g.required) requiredGroups.push(g.key);
      if (g.visible) visibleGroups.push(g.key);
    });

    const sec = val.securityScheme;
    let security_schemes: any = undefined;
    if (sec && sec.type !== 'none') {
      security_schemes = {};
      if (sec.type === 'api_key') {
        security_schemes.api_key = {
          location: sec.location,
          name: sec.name,
          prefix: sec.prefix || null,
        };
      } else if (sec.type === 'oauth2') {
        security_schemes.oauth2 = {
          location: sec.location,
          name: sec.name,
          prefix: sec.prefix || null,
          client_id: sec.clientId,
          client_secret: sec.clientSecret,
          scope: sec.scope,
          authorize_url: sec.authorizeUrl,
          access_token_url: sec.accessTokenUrl,
          refresh_token_url: sec.refreshTokenUrl,
        };
      }
    }

    return JSON.stringify(
      {
        name: val.name,
        description: val.description,
        tags,
        visibility: val.visibility,
        active: val.active,
        protocol: val.protocol,
        protocol_data: {
          method: val.method,
          path: val.path,
          server_url: val.serverUrl,
        },
        security_schemes,
        parameters: {
          type: 'object',
          properties,
          required: requiredGroups,
          visible: visibleGroups,
          additionalProperties: val.paramsAdditional,
        },
      },
      null,
      2,
    );
  });

  onSubmit() {
    const val = JSON.parse(this.generatedSchema()) as IFunctionJson;

    val.id = this.initialSchema()?.id;

    if (!this.form.valid) return val;
    this.submit.emit(val);
    return val;
  }

  onReset() {
    this.jsonInput.setValue(JSON.stringify(DEFAULT_SCHEMA), {
      emitEvent: false,
    });
    this.applyJson();
    this.activeTab.set('builder');
  }
}
