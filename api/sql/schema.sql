-- Schema para stack nova: o MariaDB executa este arquivo só na primeira
-- inicialização (volume db_data novo) via /docker-entrypoint-initdb.d.
-- Para bancos existentes, o ensureSchema() em api/lib/db.js aplica a mesma
-- DDL de forma idempotente — mantenha os DOIS arquivos sincronizados.

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  provider VARCHAR(16) NOT NULL,
  provider_id VARCHAR(64) NULL,
  username VARCHAR(64) NULL,
  password_hash VARCHAR(255) NULL,
  display_name VARCHAR(64) NULL,
  email VARCHAR(128) NULL,
  avatar_url VARCHAR(255) NULL,
  role ENUM('superadmin','admin') NOT NULL DEFAULT 'admin',
  status ENUM('active','pending','rejected','disabled') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  last_login_at DATETIME NULL,
  UNIQUE KEY uq_user_provider (provider, provider_id),
  UNIQUE KEY uq_user_username (username)
);
