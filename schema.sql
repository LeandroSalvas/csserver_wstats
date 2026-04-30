/*M!999999\- enable the sandbox mode */ 
-- MariaDB dump 10.19  Distrib 10.6.25-MariaDB, for debian-linux-gnu (x86_64)
--
-- Host: localhost    Database: csstats
-- ------------------------------------------------------
-- Server version	10.6.25-MariaDB-ubu2204

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `csstats`
--

DROP TABLE IF EXISTS `csstats`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `csstats` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `steamid` varchar(30) NOT NULL,
  `name` varchar(32) NOT NULL,
  `ip` varchar(16) NOT NULL,
  `skill` float NOT NULL DEFAULT 0,
  `kills` int(11) NOT NULL DEFAULT 0,
  `deaths` int(11) NOT NULL DEFAULT 0,
  `hs` int(11) NOT NULL DEFAULT 0,
  `tks` int(11) NOT NULL DEFAULT 0,
  `shots` int(11) NOT NULL DEFAULT 0,
  `hits` int(11) NOT NULL DEFAULT 0,
  `dmg` int(11) NOT NULL DEFAULT 0,
  `bombdef` int(11) NOT NULL DEFAULT 0,
  `bombdefused` int(11) NOT NULL DEFAULT 0,
  `bombplants` int(11) NOT NULL DEFAULT 0,
  `bombexplosions` int(11) NOT NULL DEFAULT 0,
  `h_0` int(11) NOT NULL DEFAULT 0,
  `h_1` int(11) NOT NULL DEFAULT 0,
  `h_2` int(11) NOT NULL DEFAULT 0,
  `h_3` int(11) NOT NULL DEFAULT 0,
  `h_4` int(11) NOT NULL DEFAULT 0,
  `h_5` int(11) NOT NULL DEFAULT 0,
  `h_6` int(11) NOT NULL DEFAULT 0,
  `h_7` int(11) NOT NULL DEFAULT 0,
  `connection_time` int(11) NOT NULL DEFAULT 0,
  `connects` int(11) NOT NULL DEFAULT 0,
  `roundt` int(11) NOT NULL DEFAULT 0,
  `wint` int(11) NOT NULL DEFAULT 0,
  `roundct` int(11) NOT NULL DEFAULT 0,
  `winct` int(11) NOT NULL DEFAULT 0,
  `assists` int(11) NOT NULL DEFAULT 0,
  `first_join` timestamp NOT NULL DEFAULT current_timestamp(),
  `last_join` timestamp NOT NULL DEFAULT '0000-00-00 00:00:00',
  `session_id` int(11) DEFAULT NULL,
  `session_map` varchar(32) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `steamid` (`steamid`(16)),
  KEY `name` (`name`(16)),
  KEY `ip` (`ip`)
) ENGINE=InnoDB AUTO_INCREMENT=9 DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `csstats_snapshots`
--

DROP TABLE IF EXISTS `csstats_snapshots`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `csstats_snapshots` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `steamid` varchar(32) DEFAULT NULL,
  `name` varchar(64) DEFAULT NULL,
  `map` varchar(32) DEFAULT NULL,
  `kills` int(11) DEFAULT NULL,
  `deaths` int(11) DEFAULT NULL,
  `hs` int(11) DEFAULT NULL,
  `skill` int(11) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=10612 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping events for database 'csstats'
--

--
-- Dumping routines for database 'csstats'
--
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-04-13 21:52:42
