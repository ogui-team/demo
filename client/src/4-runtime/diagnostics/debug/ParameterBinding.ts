/**
 * Parameter Binding interface
 * Defines how debug controls interact with engine systems
 */

export interface ParameterBinding {
  id: string;
  name: string;
  type: 'slider' | 'color' | 'button' | 'input' | 'checkbox' | 'select';
  min?: number;
  max?: number;
  step?: number;
  get: () => number | string | boolean;
  set?: (value: number | string | boolean) => void;
  options?: string[];
  getOptions?: () => string[];
}

export interface ParameterGroup {
  name: string;
  parameters: ParameterBinding[];
}

export class ParameterRegistry {
  private groups: Map<string, ParameterGroup> = new Map();

  addGroup(name: string): void {
    if (!this.groups.has(name)) {
      this.groups.set(name, { name, parameters: [] });
    }
  }

  addParameter(groupName: string, binding: ParameterBinding): void {
    this.addGroup(groupName);
    const group = this.groups.get(groupName);
    if (group) {
      group.parameters.push(binding);
    }
  }

  getGroup(name: string): ParameterGroup | undefined {
    return this.groups.get(name);
  }

  getGroups(): ParameterGroup[] {
    return Array.from(this.groups.values());
  }

  getParameter(groupName: string, parameterId: string): ParameterBinding | undefined {
    const group = this.groups.get(groupName);
    return group?.parameters.find((p) => p.id === parameterId);
  }

  clear(): void {
    this.groups.clear();
  }
}

