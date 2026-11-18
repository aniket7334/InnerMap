/*M!999999\- enable the sandbox mode */ 
-- MariaDB dump 10.19  Distrib 10.11.16-MariaDB, for Win64 (AMD64)
--
-- Host: localhost    Database: inner_map_db
-- ------------------------------------------------------
-- Server version	10.11.16-MariaDB

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
-- Table structure for table `downloaded_maps`
--

DROP TABLE IF EXISTS `downloaded_maps`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `downloaded_maps` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int(10) unsigned NOT NULL,
  `map_name` varchar(100) NOT NULL,
  `region` text NOT NULL,
  `zoom_min` tinyint(3) unsigned NOT NULL,
  `zoom_max` tinyint(3) unsigned NOT NULL,
  `storage_size` bigint(20) unsigned NOT NULL DEFAULT 0,
  `download_status` enum('pending','downloading','completed','partial','failed','cancelled') NOT NULL DEFAULT 'completed',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_downloaded_maps_user` (`user_id`),
  CONSTRAINT `fk_downloaded_maps_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=10 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `downloaded_maps`
--

LOCK TABLES `downloaded_maps` WRITE;
/*!40000 ALTER TABLE `downloaded_maps` DISABLE KEYS */;
INSERT INTO `downloaded_maps` VALUES
(5,1,'Mumbai','{\"south\":18.85,\"west\":72.75,\"north\":19.35,\"east\":73.1}',10,19,18336324,'completed','2026-11-17 16:46:13'),
(6,1,'Maharashtra','{\"south\":18.85,\"west\":72.75,\"north\":19.35,\"east\":73.1}',10,19,18336324,'completed','2026-11-17 17:31:09');
/*!40000 ALTER TABLE `downloaded_maps` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `location_history`
--

DROP TABLE IF EXISTS `location_history`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `location_history` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int(10) unsigned NOT NULL,
  `latitude` decimal(10,7) NOT NULL,
  `longitude` decimal(10,7) NOT NULL,
  `accuracy` float DEFAULT NULL,
  `recorded_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_location_history_user_time` (`user_id`,`recorded_at`),
  CONSTRAINT `fk_location_history_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `location_history`
--

LOCK TABLES `location_history` WRITE;
/*!40000 ALTER TABLE `location_history` DISABLE KEYS */;
INSERT INTO `location_history` VALUES
(1,1,18.9895035,72.8123872,129,'2026-11-17 11:29:14'),
(2,1,18.9894893,72.8124193,126,'2026-11-17 13:12:22'),
(3,1,18.9895093,72.8124442,143,'2026-11-17 13:13:56');
/*!40000 ALTER TABLE `location_history` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `map_features`
--

DROP TABLE IF EXISTS `map_features`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `map_features` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int(10) unsigned NOT NULL,
  `layer_id` int(10) unsigned NOT NULL,
  `name` varchar(255) DEFAULT NULL,
  `description` text DEFAULT NULL,
  `geometry_type` enum('Point','LineString','Polygon','MultiPoint','MultiLineString','MultiPolygon') NOT NULL,
  `geometry` mediumtext NOT NULL,
  `style` text DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_map_features_layer` (`layer_id`),
  KEY `idx_map_features_user` (`user_id`),
  CONSTRAINT `fk_map_features_layer` FOREIGN KEY (`layer_id`) REFERENCES `map_layers` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_map_features_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=1055 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `map_features`
--

LOCK TABLES `map_features` WRITE;
/*!40000 ALTER TABLE `map_features` DISABLE KEYS */;
/*!40000 ALTER TABLE `map_features` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `map_layers`
--

DROP TABLE IF EXISTS `map_layers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `map_layers` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int(10) unsigned NOT NULL,
  `name` varchar(150) NOT NULL,
  `source` enum('imported','drawn') NOT NULL DEFAULT 'imported',
  `file_name` varchar(255) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_map_layers_user` (`user_id`),
  CONSTRAINT `fk_map_layers_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=12 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `map_layers`
--

LOCK TABLES `map_layers` WRITE;
/*!40000 ALTER TABLE `map_layers` DISABLE KEYS */;
/*!40000 ALTER TABLE `map_layers` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `saved_locations`
--

DROP TABLE IF EXISTS `saved_locations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `saved_locations` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int(10) unsigned NOT NULL,
  `location_name` varchar(100) NOT NULL,
  `latitude` decimal(10,7) NOT NULL,
  `longitude` decimal(10,7) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_saved_locations_user` (`user_id`),
  CONSTRAINT `fk_saved_locations_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=10 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `saved_locations`
--

LOCK TABLES `saved_locations` WRITE;
/*!40000 ALTER TABLE `saved_locations` DISABLE KEYS */;
INSERT INTO `saved_locations` VALUES
(1,1,'dadar',-13.2399455,48.5156250,'2026-11-17 15:56:58'),
(2,1,'Worli',18.9894800,72.8123700,'2026-11-17 16:03:36');
/*!40000 ALTER TABLE `saved_locations` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `user_preferences`
--

DROP TABLE IF EXISTS `user_preferences`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_preferences` (
  `user_id` int(10) unsigned NOT NULL,
  `map_provider` varchar(50) NOT NULL DEFAULT 'local-vector',
  `default_lat` decimal(10,7) DEFAULT NULL,
  `default_lng` decimal(10,7) DEFAULT NULL,
  `default_zoom` tinyint(3) unsigned DEFAULT NULL,
  `show_downloaded_areas` tinyint(1) NOT NULL DEFAULT 1,
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`user_id`),
  CONSTRAINT `fk_user_preferences_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `user_preferences`
--

LOCK TABLES `user_preferences` WRITE;
/*!40000 ALTER TABLE `user_preferences` DISABLE KEYS */;
/*!40000 ALTER TABLE `user_preferences` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `email` varchar(191) NOT NULL,
  `password` varchar(255) NOT NULL,
  `location_history_enabled` tinyint(1) NOT NULL DEFAULT 0,
  `location_history_consent_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_email` (`email`)
) ENGINE=InnoDB AUTO_INCREMENT=11 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `users`
--

LOCK TABLES `users` WRITE;
/*!40000 ALTER TABLE `users` DISABLE KEYS */;
INSERT INTO `users` VALUES
(1,'Aniket Bante','aniketbante733@gmail.com','$2a$12$y675wP/mdOqQZJPe9wlm.e6tJH9u.0N/ja8/o7ZompUZFphmv.at2',1,'2026-11-17 10:32:26','2026-11-17 15:54:24','2026-11-17 16:02:26');
/*!40000 ALTER TABLE `users` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-11-17 18:49:35
