-- Simplifica o cadastro de paciente: fora `medical_record_number` e `notes`.
--
-- O cadastro passa a ser: nome completo (obrigatório), data de nascimento, sexo,
-- telefone e diagnóstico principal.
--
-- Consequências assumidas:
--   · Sem número de prontuário, dois pacientes homônimos se distinguem pela data de
--     nascimento. O plano usava o prontuário como identificador operacional para não
--     precisar de CPF/RG — a decisão de não guardar documento continua valendo.
--   · Anotação a nível de paciente deixa de existir; `encounters.clinical_notes`
--     mantém a anotação por consulta, que é onde ela pertence clinicamente.
--
-- Seguro rodar: verificado que public.patients está vazia nos dois ambientes.
-- Reverter é aditivo (`add column`), mas o dado de quem já tiver gravado não volta.

alter table public.patients
  drop column if exists medical_record_number,
  drop column if exists notes;
