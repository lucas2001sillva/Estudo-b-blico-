export const MIN_PASSWORD_LENGTH = 6;
export const MAX_PASSWORD_LENGTH = 128;
export const PASSWORD_HELP = 'Use de 6 a 128 caracteres, com pelo menos uma letra e um caractere especial, como !, @ ou #.';

// Keep the registration rule identical in the form and API. Spaces do not
// satisfy the special-character rule; letters with accents are valid letters.
export function registrationPasswordError(value) {
  if (typeof value !== 'string' || [...value].length < MIN_PASSWORD_LENGTH || [...value].length > MAX_PASSWORD_LENGTH) {
    return 'A senha deve ter entre 6 e 128 caracteres.';
  }
  if (!/\p{L}/u.test(value)) return 'A senha deve conter pelo menos uma letra.';
  if (!/[\p{P}\p{S}]/u.test(value)) return 'A senha deve conter pelo menos um caractere especial, como !, @ ou #.';
  return null;
}
