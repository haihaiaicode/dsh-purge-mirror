/** Do not replace another plugin's command or let a name collision abort startup. */
export function registerCommand(commands, definition, fallback, warn = console.warn) {
  const duplicate = (error, name) => String(error?.message || error)
    .startsWith(`command "${name}" is already registered`);
  try {
    commands.register(definition);
    return { name: definition.name, registered: definition.name, state: "registered" };
  } catch (error) {
    if (!duplicate(error, definition.name)) throw error;
    warn(`[dsh-purge] /${definition.name} is owned by another plugin; trying /${fallback}`);
  }
  try {
    commands.register({ ...definition, name: fallback });
    return { name: definition.name, registered: fallback, state: "fallback" };
  } catch (error) {
    if (!duplicate(error, fallback)) throw error;
    warn(`[dsh-purge] /${fallback} is also occupied; this command was not registered`);
    return { name: definition.name, registered: null, state: "conflict" };
  }
}
