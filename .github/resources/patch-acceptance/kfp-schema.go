package main

import (
	"fmt"
	_ "github.com/jackc/pgx/v5/stdlib"
	cm "github.com/kubeflow/pipelines/backend/src/apiserver/client_manager"
	"github.com/spf13/viper"
	"os"
	"time"
)

func main() {
	viper.Set("DBDriverName", "pgx")
	viper.Set("DBConfig.PostgreSQLConfig.DBName", "mlpipeline")
	viper.Set("DBConfig.PostgreSQLConfig.Host", "127.0.0.1")
	viper.Set("DBConfig.PostgreSQLConfig.Port", 15432)
	viper.Set("DBConfig.PostgreSQLConfig.User", "user")
	viper.Set("DBConfig.PostgreSQLConfig.Password", "acceptance-only")
	viper.Set("DBConfig.PostgreSQLConfig.ExtraParams", map[string]string{"sslmode": "disable"})
	db, dialect, _ := cm.InitDBClient(time.Minute)
	defer db.Close()
	if dialect.Name() != "pgx" {
		panic("wrong dialect")
	}
	if os.Args[1] == "seed" {
		_, err := db.Exec(`INSERT INTO experiments ("UUID","Name","Description","CreatedAtInSec","LastRunCreatedAtInSec","Namespace","StorageState") VALUES ('upgrade-check','preserved experiment','before PostgreSQL patch',1,0,'kubeflow','AVAILABLE')`)
		if err != nil {
			panic(err)
		}
	}
	var name, description string
	if err := db.QueryRow(`SELECT "Name","Description" FROM experiments WHERE "UUID"='upgrade-check'`).Scan(&name, &description); err != nil {
		panic(err)
	}
	if name != "preserved experiment" || description != "before PostgreSQL patch" {
		panic("experiment changed")
	}
	if _, err := db.Exec(`UPDATE experiments SET "LastRunCreatedAtInSec"="LastRunCreatedAtInSec"+1 WHERE "UUID"='upgrade-check'`); err != nil {
		panic(err)
	}
	var tables int
	if err := db.QueryRow(`SELECT count(*) FROM information_schema.tables WHERE table_schema='public'`).Scan(&tables); err != nil {
		panic(err)
	}
	if tables < 10 {
		panic("KFP schema missing")
	}
	fmt.Printf("KFP InitDBClient migration + persisted experiment read/write passed; %d tables\n", tables)
}
