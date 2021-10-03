export = {
  connection: {
    host: process.env.DB_HOST,
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    control_panel_database: process.env.DB_CONTROL_PANEL_NAME,
    mongo_port: process.env.DB_MONGO_PORT,
    mysql_port: process.env.DB_MYSQL_PORT,
  },
  migrations_path: process.env.DB_MIGRATIONS_PATH,
  seeds_path: process.env.DB_SEEDS_PATH,
};
