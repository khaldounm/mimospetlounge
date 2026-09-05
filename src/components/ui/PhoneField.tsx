"use client";

import { useMemo, useState } from "react";
import {
  Autocomplete,
  Box,
  Stack,
  TextField,
  createFilterOptions,
} from "@mui/material";
import {
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
} from "libphonenumber-js/min";
import type { CountryCode } from "libphonenumber-js/min";

// The clinic is in Lebanon, so default new numbers to +961.
const DEFAULT_COUNTRY: CountryCode = "LB";

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

// Turn an ISO country code (e.g. "LB") into its flag emoji by mapping each
// letter to its regional-indicator symbol.
function flagEmoji(code: string): string {
  return code
    .toUpperCase()
    .replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

interface CountryOption {
  code: CountryCode;
  name: string;
  callingCode: string;
  flag: string;
}

// Let the user search by country name ("Leb"), ISO code ("LB") or dialling
// code (typed with or without the leading "+").
const filterCountries = createFilterOptions<CountryOption>({
  stringify: (c) => `${c.name} ${c.code} +${c.callingCode} ${c.callingCode}`,
});

interface PhoneFieldProps {
  // Current value as stored (E.164, e.g. "+96170121556"), or "".
  value: string;
  // Emits the composed E.164 string, or "" when the number is cleared.
  onChange: (value: string) => void;
  label?: string;
  fullWidth?: boolean;
}

// Phone input with a country-code selector. The user picks a country (default
// Lebanon) and types the local number; the field composes a clean E.164 value
// so downstream messaging never has to guess the country code.
export default function PhoneField({
  value,
  onChange,
  label = "Phone",
  fullWidth,
}: PhoneFieldProps) {
  const countries = useMemo<CountryOption[]>(
    () =>
      getCountries()
        .map((code) => ({
          code,
          name: regionNames.of(code) ?? code,
          callingCode: getCountryCallingCode(code),
          flag: flagEmoji(code),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [],
  );

  // Seed country + national parts from the initial value. The dialog remounts
  // this component on open (via key), so initializing once is enough.
  const initial = useMemo(
    () => parsePhoneNumberFromString(value || ""),
    [value],
  );
  const [country, setCountry] = useState<CountryCode>(
    initial?.country ?? DEFAULT_COUNTRY,
  );
  const [national, setNational] = useState(initial?.nationalNumber ?? "");

  function emit(nextCountry: CountryCode, nextNational: string) {
    const digits = nextNational.replace(/\D/g, "");
    if (!digits) {
      onChange("");
      return;
    }
    // Parsing with a country context strips national trunk prefixes (e.g. the
    // Lebanese "0" in "03...") and yields a proper E.164 number.
    const parsed = parsePhoneNumberFromString(nextNational, nextCountry);
    onChange(
      parsed
        ? parsed.number
        : `+${getCountryCallingCode(nextCountry)}${digits}`,
    );
  }

  const parsedNow = parsePhoneNumberFromString(national, country);
  const invalid =
    national.trim().length > 0 && !(parsedNow && parsedNow.isValid());

  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{ width: fullWidth ? "100%" : undefined }}
    >
      <Autocomplete
        options={countries}
        value={countries.find((c) => c.code === country)}
        onChange={(_, next) => {
          if (!next) return;
          setCountry(next.code);
          emit(next.code, national);
        }}
        filterOptions={filterCountries}
        getOptionLabel={(c) => `${c.flag} +${c.callingCode}`}
        isOptionEqualToValue={(a, b) => a.code === b.code}
        autoHighlight
        disableClearable
        openOnFocus
        sx={{ minWidth: 150 }}
        slotProps={{ paper: { sx: { width: 280 } } }}
        renderOption={(props, c) => {
          const { key, ...rest } = props as typeof props & { key: string };
          return (
            <Box component="li" key={key} {...rest}>
              {c.flag}&nbsp;&nbsp;{c.name} (+{c.callingCode})
            </Box>
          );
        }}
        renderInput={(params) => <TextField {...params} label="Code" />}
      />
      <TextField
        label={label}
        value={national}
        onChange={(e) => {
          setNational(e.target.value);
          emit(country, e.target.value);
        }}
        error={invalid}
        helperText={invalid ? "Invalid phone number" : undefined}
        fullWidth
        inputMode="tel"
      />
    </Stack>
  );
}
