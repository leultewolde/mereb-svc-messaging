secret:
  enabled: true
  nameOverride: {{SECRET_NAME}}
  stringData:
    DATABASE_URL: {{DATABASE_URL}}
    SPLUNK_HEC_TOKEN: {{SPLUNK_HEC_TOKEN}}
