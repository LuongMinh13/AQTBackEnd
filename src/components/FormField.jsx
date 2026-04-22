import "../assets/Style/components/FormField.css";

/**
 * Wrapper réutilisable pour un champ de formulaire.
 * Gère le label, l'input, et l'affichage des erreurs.
 *
 * Props :
 *  - label       : texte du label
 *  - name        : attribut name de l'input
 *  - type        : type d'input (text, number, email, date, tel...)
 *  - value       : valeur contrôlée
 *  - onChange    : handler onChange
 *  - placeholder : placeholder
 *  - required    : boolean
 *  - error       : message d'erreur à afficher
 *  - icon        : node optionnel (SVG) affiché à gauche de l'input
 *  - ...props    : tout autre prop natif de <input>
 */
export default function FormField({
  label,
  name,
  type = "text",
  value,
  onChange,
  placeholder,
  required = false,
  error,
  icon,
  ...props
}) {
  const id = `field-${name}`;

  return (
    <div className={"form-field" + (error ? " has-error" : "")}>
      {label && (
        <label htmlFor={id} className="form-field__label">
          {label}
          {required && <span className="form-field__required"> *</span>}
        </label>
      )}

      <div className="form-field__input-wrap">
        {icon && <span className="form-field__icon">{icon}</span>}
        <input
          id={id}
          name={name}
          type={type}
          value={value ?? ""}
          onChange={onChange}
          placeholder={placeholder}
          required={required}
          className={"form-field__input" + (icon ? " has-icon" : "")}
          {...props}
        />
      </div>

      {error && <p className="form-field__error">{error}</p>}
    </div>
  );
}
