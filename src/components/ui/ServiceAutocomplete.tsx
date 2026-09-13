"use client";

import { useMemo } from "react";
import {
  Autocomplete,
  ListSubheader,
  TextField,
  createFilterOptions,
} from "@mui/material";
import { CUSTOM_SUBCATEGORY } from "@/constants/clinical";
import type { ServicePickerOption } from "@/types/entities";

interface Props {
  services: ServicePickerOption[];
  /** A service name, CUSTOM_SUBCATEGORY, or "" for nothing picked. */
  value: string;
  onChange: (value: string) => void;
  label?: string;
  helperText?: string;
  autoFocus?: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
}

// Pseudo-option at the foot of every list: the record is not a catalogue
// service and gets a free title instead. Id 0 so it can never collide.
const CUSTOM_OPTION: ServicePickerOption = {
  serviceId: 0,
  name: "Other / custom",
  category: null,
};

const UNFILED_GROUP = "Other services";

function groupOf(option: ServicePickerOption): string {
  if (option.serviceId === 0) return "";
  return option.category?.trim() || UNFILED_GROUP;
}

// Match on the category too, so "vacc" lists every vaccine whatever it is
// called, and "dent" finds the scale and polish.
const filter = createFilterOptions<ServicePickerOption>({
  stringify: (o) => `${o.name} ${o.category ?? ""}`,
});

// Type-to-find picker over the whole catalogue, grouped by category. This
// replaces a dropdown that was filtered by record type, which opened empty on
// the default type and made the vet guess that the type had to change first.
// Here the service is picked first and the type follows from its category.
export default function ServiceAutocomplete({
  services,
  value,
  onChange,
  label = "Service",
  helperText,
  autoFocus,
  inputRef,
}: Props) {
  // MUI groups by walking the list in order, so it is sorted by group first:
  // named categories alphabetically, the unfiled ones after them, the custom
  // entry last. A value the catalogue no longer carries (a service retired
  // since the sitting began) is added so the field can still show it.
  const options = useMemo(() => {
    const sorted = [...services].sort((a, b) => {
      const ga = groupOf(a);
      const gb = groupOf(b);
      if (ga !== gb) {
        if (ga === UNFILED_GROUP) return 1;
        if (gb === UNFILED_GROUP) return -1;
        return ga.localeCompare(gb);
      }
      return a.name.localeCompare(b.name);
    });
    if (
      value &&
      value !== CUSTOM_SUBCATEGORY &&
      !sorted.some((o) => o.name === value)
    ) {
      sorted.push({ serviceId: -1, name: value, category: null });
    }
    return [...sorted, CUSTOM_OPTION];
  }, [services, value]);

  const selected = useMemo(() => {
    if (value === CUSTOM_SUBCATEGORY) return CUSTOM_OPTION;
    if (!value) return null;
    return options.find((o) => o.name === value) ?? null;
  }, [options, value]);

  return (
    <Autocomplete
      options={options}
      value={selected}
      onChange={(_e, option) =>
        onChange(
          option === null
            ? ""
            : option.serviceId === 0
              ? CUSTOM_SUBCATEGORY
              : option.name,
        )
      }
      // The custom entry is always on offer, so a search with no match still
      // has somewhere to go.
      filterOptions={(all, state) => [
        ...filter(
          all.filter((o) => o.serviceId !== 0),
          state,
        ),
        CUSTOM_OPTION,
      ]}
      groupBy={groupOf}
      renderGroup={(params) => (
        <li key={params.key}>
          {params.group && (
            <ListSubheader
              component="div"
              sx={{ top: -8, bgcolor: "background.paper", lineHeight: "32px" }}
            >
              {params.group}
            </ListSubheader>
          )}
          <ul style={{ padding: 0 }}>{params.children}</ul>
        </li>
      )}
      getOptionLabel={(o) => o.name}
      getOptionKey={(o) => `${o.serviceId}:${o.name}`}
      isOptionEqualToValue={(o, v) => o.name === v.name}
      // Enter on a typed search takes the first match, so "rab", Enter is the
      // whole pick. The list opens on typing or on the arrow, not on focus:
      // the field is focused on open and after every save, and a list that
      // dropped over the form each time would hide the pet and sitting chips
      // the vet is about to click.
      autoHighlight
      fullWidth
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          helperText={helperText}
          autoFocus={autoFocus}
          inputRef={inputRef}
        />
      )}
    />
  );
}
